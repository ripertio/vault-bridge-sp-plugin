import { initSyncRegistry, syncAllNow, setConfigBridge, shutdownSyncRegistry } from './sync/sync-manager';
import { loadLocalConfig, saveLocalConfig } from './local-config';
import type { LocalUserCfgV2 } from './local-config';
import { fetchLatestRelease, isNewerVersion } from './update-check';
import type { UpdateInfo } from './update-check';
import { log } from '../shared/logger';
import { runDailyNoteDryRun } from './daily/daily-runner';
import { scheduleDailyNoteRun, cancelDailyNoteRun, startDailyNoteWatcher, stopDailyNoteWatcher } from './daily/daily-scheduler';
import { startFileWatcher } from './sync/file-watcher';
import { resolveDailyNoteCfg } from './daily/daily-note';
import { validateDailySettings } from './daily/daily-settings';

// Current plugin version, injected from manifest.json at build time (see build.js).
declare const __PLUGIN_VERSION__: string;

/** Parse config from the string returned by loadSyncedData, or return null. */
const parseSyncedConfig = (raw: string | null): LocalUserCfgV2 | null => {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.bindings)) return parsed as LocalUserCfgV2;
  } catch { /* ignore */ }
  return null;
};

// Tracks the last bindings JSON we applied, to detect real binding changes.
let activeBindingsJson = '';

// Tracks the last project list JSON we cached, to skip redundant localStorage
// writes when the SP project list is unchanged.
let cachedProjectsJson = '';

// Always-current in-memory copy of the full config (bindings + any extra fields).
// Updated on boot from localStorage and whenever the UI saves via the bridge.
let currentConfig: LocalUserCfgV2 = { version: 2, bindings: [] };

// ── Config persistence (device-local, v0.4.0) ───────────────────────────────
// The full in-memory config is persisted to the background's OWN localStorage
// (see local-config.ts), which is device-local (Electron on-disk) and NOT synced
// across devices. This replaces persistDataSynced, whose cross-device sync let a
// device's absolute file path activate on another device and delete tasks against
// a stale/foreign file. background.ts is the single writer; the sandboxed iframe
// never touches storage directly — it routes reads/writes through the onMessage
// bridge below. localStorage writes are synchronous, so the old serialized-async
// write chain (persistChain / pendingConfigWrites) is no longer needed.
const persistConfig = (): void => {
  saveLocalConfig(currentConfig);
};

/**
 * Fetch the current project list from SP and cache it on the config
 * (`_cachedProjects`) so the sandboxed iframe UI can read it via the onMessage
 * bridge (getAllProjects() from inside an iframe often returns only Inbox).
 *
 * Only writes if the project list has actually changed — reduces unnecessary
 * localStorage churn.
 */
const refreshProjectsCache = async (): Promise<void> => {
  try {
    const allProjects = await PluginAPI.getAllProjects();
    const newProjectsJson = JSON.stringify(allProjects.map((p) => ({ id: p.id, title: p.title })));
    if (newProjectsJson === cachedProjectsJson) return; // unchanged — skip write
    cachedProjectsJson = newProjectsJson;
    const cachedProjects = JSON.parse(newProjectsJson) as { id: string; title: string }[];
    // Store on currentConfig so the single persist below carries every extra
    // field (both _cachedProjects and _lastSynced) instead of dropping one.
    currentConfig._cachedProjects = cachedProjects;
    persistConfig();
  } catch (err) {
    log.error('[sync-md-multi] Failed to cache projects:', err);
  }
};

// Debounced persist of the full in-memory config (used for _lastSynced updates,
// which fire on every successful sync — coalesce them into one write).
let persistConfigTimer: ReturnType<typeof setTimeout> | null = null;
const persistConfigSoon = (): void => {
  if (persistConfigTimer) clearTimeout(persistConfigTimer);
  persistConfigTimer = setTimeout(() => {
    persistConfigTimer = null;
    persistConfig();
  }, 2_000);
};

// ── Self-update notifier ────────────────────────────────────────────────────
// A *notifier*, never an auto-updater (SP exposes no self-reinstall API — install
// stays manual). We check the public Codeberg release feed on every app startup
// and then every 24 h while the app stays open, and when a newer version exists
// surface it via a startup snack, a header button next to "Sync Now" that opens
// the release page, and a marker in the config-panel footer (rendered by the
// iframe from the persisted _latestVersion).
const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // in-session re-check cadence
let upgradeButtonRegistered = false;
let startupSnackShown = false;

/**
 * Register the "update available" header button (idempotent per session).
 * Registered LATE (only once an update is found), unlike the Sync Now button —
 * acceptable because it's an optional affordance and the footer marker is the
 * guaranteed path. NOTE: SP renders header buttons neutral-gray regardless of
 * the `color` field (verified primary/accent/warn identical in 18.16), so the
 * colored/attention-grabbing signal is the startup snack + the footer marker,
 * not this button — the button is distinguished only by its `upgrade` icon.
 */
const registerUpgradeButton = (info: UpdateInfo): void => {
  if (upgradeButtonRegistered) return;
  upgradeButtonRegistered = true;
  try {
    PluginAPI.registerHeaderButton({
      label: `sync.md Multi: Update available (v${info.latestVersion})`,
      icon: 'upgrade',
      // SP renders header buttons neutral-gray regardless of this field (verified
      // primary/accent/warn all identical in 18.16); kept as the semantically
      // correct value in case a future SP theme honours it.
      color: 'primary',
      onClick: () => {
        // Opening an external URL from the background context is not guaranteed
        // in the SP sandbox — fall back to the config panel, whose footer carries
        // a working link — so the click always leads somewhere useful.
        try {
          const w = (globalThis as unknown as { window?: { open?: (u: string) => unknown } })
            .window;
          if (info.htmlUrl && w?.open) {
            w.open(info.htmlUrl);
            return;
          }
        } catch {
          /* fall through to the config panel */
        }
        try {
          PluginAPI.showIndexHtmlAsView();
        } catch {
          /* nothing more we can do */
        }
      },
    });
  } catch (err) {
    upgradeButtonRegistered = false;
    log.error('[sync-md-multi] registerHeaderButton (upgrade) failed:', err);
  }
};

/**
 * Surface an available update: always (re)register the header button, and — only
 * on the app-startup check (`isStartup`) — show a colored snack ONCE per app
 * launch. The interval re-checks during a session update the button/footer
 * silently (no snack), so the snack never nags mid-session.
 */
const surfaceUpdate = (info: UpdateInfo, isStartup: boolean): void => {
  registerUpgradeButton(info);
  if (isStartup && !startupSnackShown) {
    startupSnackShown = true;
    try {
      PluginAPI.showSnack({
        msg: `sync.md Multi: version ${info.latestVersion} available`,
        type: 'INFO',
        ico: 'upgrade',
      });
    } catch (err) {
      log.error('[sync-md-multi] update snack failed:', err);
    }
  }
};

/**
 * Check for a newer release and, if found, persist the result and surface it.
 * Fire-and-forget: never throws, never blocks sync.
 *
 * Cadence (by design — NOT throttled by a stored timestamp): a fresh network
 * check runs on **every app startup** and then **every 24 h** while the app
 * stays open (the startup call + the daily interval that calls this). Checking
 * on each restart is intentional so a just-published release is picked up
 * immediately rather than up to a day later.
 *
 * A failed check (no nodeExecution consent yet, offline, timeout, parse error)
 * resolves to `null` and simply returns — the next startup / interval retries,
 * so the notifier survives the first-run race where the check fires before the
 * nodeExecution consent dialog is accepted. On a successful check the persisted
 * `_latestVersion`/`_latestUrl` let the config-panel footer render the marker on
 * open without re-hitting the network; when up to date, any stale record is
 * cleared so the marker disappears once the user has updated.
 *
 * `isStartup` is true only for the check fired at plugin load — it gates the
 * one-per-launch snack (the daily interval passes false → button/footer refresh
 * silently, no snack).
 */
const maybeCheckForUpdate = async (isStartup = false): Promise<void> => {
  try {
    // fetchLatestRelease returns the latest release when the network round-trip
    // succeeds (whether or not it's newer), and null ONLY when the check failed.
    const latest = await fetchLatestRelease();
    if (!latest) return;

    currentConfig._lastUpdateCheck = new Date().toISOString(); // informational only
    if (isNewerVersion(latest.latestVersion, __PLUGIN_VERSION__)) {
      currentConfig._latestVersion = latest.latestVersion;
      currentConfig._latestUrl = latest.htmlUrl;
      surfaceUpdate(latest, isStartup);
    } else {
      // Up to date — drop any stale record so the config panel / a future open
      // doesn't show a phantom "update available" marker after the user updated.
      delete currentConfig._latestVersion;
      delete currentConfig._latestUrl;
    }
    persistConfigSoon();
  } catch (err) {
    log.error('[sync-md-multi] update check error:', err);
  }
};

/**
 * Apply a config pushed by the config-panel UI through the onMessage bridge
 * (saveConfig). background.ts owns the transient / device-local fields
 * (_lastSynced, _cachedProjects and the update-notifier state); the UI only
 * manages `version` + `bindings`. If the bindings actually changed, restart the
 * sync registry so the new/edited/removed bindings take effect immediately —
 * there is no polling or persistedDataChanged round-trip anymore, because the UI
 * and background share this process and the change arrives synchronously here.
 */
const applyConfigFromUi = (incoming: LocalUserCfgV2): void => {
  try {
    const newBindingsJson = JSON.stringify(incoming?.bindings ?? []);
    const bindingsChanged = newBindingsJson !== activeBindingsJson;
    // Take version + bindings from the UI; preserve every field the UI does not
    // manage from the in-memory source of truth (never reverted by a UI save).
    currentConfig = {
      version: incoming?.version ?? 2,
      bindings: incoming?.bindings ?? [],
      _lastSynced: currentConfig._lastSynced ?? {},
      _cachedProjects: currentConfig._cachedProjects,
      _lastUpdateCheck: currentConfig._lastUpdateCheck,
      _latestVersion: currentConfig._latestVersion,
      _latestUrl: currentConfig._latestUrl,
      // Bindings saves keep the stored daily settings; daily is saved via saveDailySettings.
      daily: currentConfig.daily,
      _dailyBaseline: currentConfig._dailyBaseline,
    };
    persistConfig();
    if (bindingsChanged) {
      activeBindingsJson = newBindingsJson;
      log.log('[sync-md-multi] Config saved from UI — restarting sync registry');
      initSyncRegistry(currentConfig.bindings, currentConfig._lastSynced ?? {});
    }
  } catch (err) {
    log.error('[sync-md-multi] Failed to apply config from UI:', err);
  }
};

// Baseline storage for the daily-note sync (device-local, saved with the config).
const dailyDeps = () => ({
  getBaseline: () => currentConfig._dailyBaseline ?? {},
  saveBaseline: (baseline: NonNullable<LocalUserCfgV2['_dailyBaseline']>) => {
    currentConfig = { ...currentConfig, _dailyBaseline: baseline };
    persistConfig();
  },
});

(async () => {
  // ── UI registration (synchronous, before any await) ──────────────────────
  // Registered first thing, before the awaits below, so the registration is not
  // delayed past the point where SP builds its header toolbar. On macOS 18.9.1
  // the header button did not render when registered at the end of this IIFE
  // (after loadSyncedData/refreshProjectsCache resolved); doing it synchronously
  // here tests whether that was a registration-timing race. The try/catch logs
  // any silent failure so we can tell "never registered" from "registered but
  // not painted" via the dev console.
  try {
    PluginAPI.registerMenuEntry({
      label: 'sync.md Multi',
      icon: 'arrows_up_down_circle',
      onClick: () => {
        PluginAPI.showIndexHtmlAsView();
      },
    });
  } catch (err) {
    log.error('[sync-md-multi] registerMenuEntry failed:', err);
  }

  try {
    PluginAPI.registerHeaderButton({
      label: 'sync.md Multi: Sync Now',
      icon: 'arrows_up_down_circle',
      onClick: () => {
        syncAllNow();
        PluginAPI.showSnack({ msg: 'sync.md Multi: bidirectional sync triggered', type: 'INFO' });
      },
    });
  } catch (err) {
    log.error('[sync-md-multi] registerHeaderButton failed:', err);
  }

  // ── Config bridge (sync layer → config owner) ────────────────────────────
  // The sync layer reports successful syncs and requests binding deletions
  // through these callbacks; background.ts remains the single owner of the
  // persisted config. Wired synchronously so it's ready before any sync runs.
  setConfigBridge({
    reportSynced: (bindingId, isoTime) => {
      currentConfig._lastSynced = { ...(currentConfig._lastSynced ?? {}), [bindingId]: isoTime };
      persistConfigSoon();
    },
    deleteBinding: (bindingId) => {
      currentConfig = {
        ...currentConfig,
        bindings: currentConfig.bindings.filter((b) => b.id !== bindingId),
      };
      if (currentConfig._lastSynced) {
        const next = { ...currentConfig._lastSynced };
        delete next[bindingId];
        currentConfig._lastSynced = next;
      }
      // Keep activeBindingsJson in step so the poll/hook doesn't read this back
      // as an external change and trigger a redundant full registry restart
      // (the affected session was already disposed by the sync layer).
      activeBindingsJson = JSON.stringify(currentConfig.bindings);
      persistConfig();
    },
    repointBinding: (bindingId, newProjectId) => {
      currentConfig = {
        ...currentConfig,
        bindings: currentConfig.bindings.map((b) =>
          b.id === bindingId ? { ...b, projectId: newProjectId } : b,
        ),
      };
      // The sync layer updated its live session in place, so keep
      // activeBindingsJson in step to avoid a redundant registry restart.
      activeBindingsJson = JSON.stringify(currentConfig.bindings);
      persistConfig();
    },
    updateBindingTitle: (bindingId, title) => {
      currentConfig = {
        ...currentConfig,
        bindings: currentConfig.bindings.map((b) =>
          b.id === bindingId ? { ...b, projectTitle: title } : b,
        ),
      };
      // Keep activeBindingsJson in step so this internal title capture doesn't
      // read back as an external change and restart the registry.
      activeBindingsJson = JSON.stringify(currentConfig.bindings);
      persistConfig();
    },
  });

  // ── Wait for SP to be ready before touching data (SP 18.13.1 lifecycle) ────
  // The menu/header above are registered synchronously first (macOS toolbar
  // timing). Then, if the SP API exposes `onReady` (18.13.1+), wait for it so we
  // don't start loading config / initial sync before SP has finished activating.
  // Feature-detected — older API versions (^1.0.1 types) don't declare it — with
  // a 3 s fallback so a missing/never-firing callback can't hang startup.
  const pluginApi = PluginAPI as unknown as { onReady?: (cb: () => void) => void };
  if (typeof pluginApi.onReady === 'function') {
    await new Promise<void>((resolve) => {
      let done = false;
      const finish = (): void => {
        if (!done) {
          done = true;
          resolve();
        }
      };
      try {
        pluginApi.onReady!(finish);
      } catch {
        finish();
      }
      setTimeout(finish, 3_000);
    });
  }

  // ── Initial load (device-local, v0.4.0) ──────────────────────────────────────
  // Config now lives in the background's OWN localStorage (device-local, NOT synced
  // across devices — see local-config.ts). Load it synchronously, then run a
  // MIGRATION from the pre-0.4.0 cross-device synced blob: earlier versions
  // persisted the whole config via persistDataSynced, which SP syncs across
  // devices — the very hazard v0.4.0 removes. On each startup, if that blob still
  // holds config and we have nothing locally yet, seed localStorage from it; then
  // clear the synced blob so it stops circulating through SP sync. For a single
  // device this is just a one-time re-seed of its own config.
  //
  // KEEP THIS BLOCK FOR SEVERAL RELEASES — do NOT remove it as long as any user
  // could still be upgrading from a pre-0.4.0 install (a user may jump 0.3.x →
  // 0.6.x directly, and their config would only exist in the synced blob). It is
  // cheap and idempotent: once the blob is cleared, loadSyncedData() returns
  // nothing and this becomes a no-op every startup. Only drop it once we are
  // confident essentially no pre-0.4.0 install remains (tentatively ~v0.8.0+),
  // and drop the persistDataSynced/loadSyncedData manifest permissions with it.
  currentConfig = loadLocalConfig();
  try {
    const legacyRaw = await PluginAPI.loadSyncedData();
    const legacy = parseSyncedConfig(legacyRaw);
    if (legacy && Array.isArray(legacy.bindings) && legacy.bindings.length > 0) {
      // Conservative: only seed when we have no local config yet, so a device that
      // already configured its own bindings is never overwritten by a foreign blob.
      if (currentConfig.bindings.length === 0) {
        currentConfig = {
          version: 2,
          bindings: legacy.bindings,
          _lastSynced: legacy._lastSynced ?? {},
          _cachedProjects: legacy._cachedProjects,
          _lastUpdateCheck: legacy._lastUpdateCheck,
          _latestVersion: legacy._latestVersion,
          _latestUrl: legacy._latestUrl,
        };
        persistConfig();
        log.log('[sync-md-multi] Migrated config from synced storage to local storage');
      }
      // Clear the legacy synced blob so it stops propagating across devices.
      try {
        await PluginAPI.persistDataSynced('');
      } catch (err) {
        log.error('[sync-md-multi] Failed to clear legacy synced config:', err);
      }
    }
  } catch {
    /* no legacy synced data (or API unavailable) — nothing to migrate */
  }

  // Daily notes: dry-run only, and only when the user has enabled it.
  startDailyNoteWatcher(() => resolveDailyNoteCfg(currentConfig.daily), dailyDeps(), startFileWatcher);
  void runDailyNoteDryRun(resolveDailyNoteCfg(currentConfig.daily), dailyDeps()).catch((err) =>
    log.error('daily dry-run failed', err),
  );

  activeBindingsJson = JSON.stringify(currentConfig?.bindings ?? []);
  if (currentConfig?.bindings && currentConfig.bindings.length > 0) {
    initSyncRegistry(currentConfig.bindings, currentConfig._lastSynced ?? {});
  }

  // ── Config bridge (iframe UI ↔ background) ────────────────────────────────
  // The sandboxed config panel (src/ui/index.html) runs in a different context and
  // has NO access to the background's localStorage. It reads and writes config by
  // messaging the background through PluginAPI.onMessage — the background is the
  // single owner/writer of the device-local config. This replaces the old model
  // where the iframe called persistDataSynced directly (the cross-device hazard).
  //   getConfig   → the current in-memory config (bindings + cached projects)
  //   saveConfig  → applyConfigFromUi(incoming) (persist + restart registry on change)
  //   getProjects → refresh + return the SP project list for the dropdown
  // Feature-detected: onMessage is not in the ^1.0.1 API types but is bound at
  // runtime for uploaded plugins (confirmed on the user's SP).
  const messageApi = PluginAPI as unknown as {
    onMessage?: (cb: (message: any) => unknown | Promise<unknown>) => void;
  };
  if (typeof messageApi.onMessage === 'function') {
    messageApi.onMessage(async (message: any) => {
      const type = message?.type;
      if (type === 'getConfig') {
        return { success: true, config: currentConfig };
      }
      if (type === 'saveConfig') {
        applyConfigFromUi(message.config as LocalUserCfgV2);
        return { success: true };
      }
      if (type === 'saveDailySettings') {
        const result = validateDailySettings(message.daily ?? {});
        if (!result.ok) return { success: false, error: result.error };
        currentConfig = { ...currentConfig, daily: result.cfg };
        persistConfig();
        // Restart the watcher so it follows the new folder or filename format.
        startDailyNoteWatcher(() => resolveDailyNoteCfg(currentConfig.daily), dailyDeps(), startFileWatcher);
        return { success: true, daily: result.cfg };
      }
      if (type === 'getProjects') {
        await refreshProjectsCache();
        return { success: true, projects: currentConfig._cachedProjects ?? [] };
      }
      return { success: false, error: 'unknown message type' };
    });
  } else {
    log.error('[sync-md-multi] onMessage unavailable — config panel cannot load/save');
  }

  // NOTE (v0.4.0): there is no more persistedDataChanged hook or 5 s config poll.
  // The config panel and the background share this process; a binding created /
  // edited / removed in the panel arrives synchronously via the onMessage
  // `saveConfig` bridge above, which calls applyConfigFromUi → initSyncRegistry
  // immediately. The old cross-device synced storage (and the hook/poll that
  // watched it) is gone — that store is what caused a foreign device's absolute
  // path to activate here, so removing it is the whole point of v0.4.0.

  // Self-update notifier: re-check every 24 h while the app stays open (the
  // startup call below covers the on-launch check). maybeCheckForUpdate() always
  // hits the release feed — there is no stored throttle since v0.3.3 — so each
  // tick is a fresh check. MUST be cleared in onUnload (zombie-timer lesson).
  const updateCheckId = setInterval(() => void maybeCheckForUpdate(), UPDATE_CHECK_INTERVAL_MS);

  // ── Teardown on unload (SP 18.13.1) ───────────────────────────────────────
  // CRITICAL: SP unregisters our hooks when the plugin is reloaded/reinstalled,
  // but it does NOT stop our own setInterval timers (the update-check timer + the
  // file watchers). Without this teardown, every reinstall left a ZOMBIE instance
  // still ticking and still able to show dialogs / create projects, fighting the
  // new instance — the runaway duplicate projects seen in testing. onUnload stops
  // the timers and disposes every session (which clears its watcher + debounce
  // timers). Feature-detected.
  const unloadApi = PluginAPI as unknown as { onUnload?: (cb: () => void) => void };
  if (typeof unloadApi.onUnload === 'function') {
    unloadApi.onUnload(() => {
      clearInterval(updateCheckId);
      if (persistConfigTimer) clearTimeout(persistConfigTimer);
      cancelDailyNoteRun();
      stopDailyNoteWatcher();
      shutdownSyncRegistry();
      log.log('[sync-md-multi] onUnload: timers + sessions torn down');
    });
  } else {
    log.error('[sync-md-multi] onUnload not available — reloads may leave zombie timers');
  }

  // projectListUpdate: fired when the user adds, renames, or removes a project.
  // Refresh the cache so the fallback path in loadProjects() has up-to-date data.
  PluginAPI.registerHook('projectListUpdate' as any, () => void refreshProjectsCache());

  // Daily notes: re-run after task edits (debounced). Gated by daily.enabled in
  // the runner, so this is a no-op while the feature is off.
  PluginAPI.registerHook('taskUpdate' as any, () =>
    scheduleDailyNoteRun(() => resolveDailyNoteCfg(currentConfig.daily), dailyDeps()),
  );

  // ── Project list cache (non-critical → fire-and-forget) ───────────────────
  // Only populates the iframe dropdown; must NOT block the detection wiring
  // above (a slow getAllProjects()/persistDataSynced() must not delay it).
  void refreshProjectsCache();

  // ── Self-update check (non-critical → fire-and-forget) ────────────────────
  // Runs once on startup (a fresh network check — no stored throttle since v0.3.3),
  // then on the daily interval above. `true` = this is the startup check, which
  // is the only one allowed to show the one-per-launch snack. Never blocks sync.
  void maybeCheckForUpdate(true);

  // NOTE: the menu entry and header "Sync Now" button are registered
  // synchronously at the very top of this IIFE (before the awaits above), to
  // avoid a registration-timing race with SP's header toolbar on macOS.
})();
