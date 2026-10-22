import {
  initSyncRegistry,
  syncAllNow,
  setConfigBridge,
  shutdownSyncRegistry,
  isStructuralTaskAction,
} from './sync/sync-manager';
import { loadLocalConfig, saveLocalConfig, mergeUiConfig } from './local-config';
import type { LocalUserCfgV2, SyncBindingCfg } from './local-config';
import { fetchLatestRelease, isNewerVersion } from './update-check';
import type { UpdateInfo } from './update-check';
import { log } from '../shared/logger';
import { runDailyNoteDryRun } from './daily/daily-runner';
import {
  scheduleDailyNoteRun,
  cancelDailyNoteRun,
  startDailyNoteWatcher,
  stopDailyNoteWatcher,
  startDayChangeCheck,
  stopDayChangeCheck,
} from './daily/daily-scheduler';
import { startFileWatcher } from './sync/file-watcher';
import { resolveDailyNoteCfg } from './daily/daily-note';
import { validateDailySettings } from './daily/daily-settings';
import { validateProjectsDirCfg, resolveProjectsDirCfg } from './projects/project-dir';
import { computeEffectiveBindings } from './projects/effective-bindings';
import { assertRealPathInside, listSubfolders, renameSubfolder } from './helper/file-utils';
import { planRenames } from './projects/rename';
import { migrateManualBindings } from './projects/migrate-bindings';
import { effectiveVaultPath, validateVaultPath } from './vault';
import { folderListChanged } from './projects/folder-poll';
import { buildLinkTable, ignoreRow, unignoreRow } from './projects/link-table';
import { validFolderName, validBindFile } from './projects/project-dir';
import { boundFilesPresent, listProjectEntries } from './projects/project-entries';
import { createSerialQueue } from './helper/serial-queue';
import { INBOX_PROJECT_ID } from './daily/daily-plan';
import { lazySetInterval } from './helper/lazy-set-interval';
import { setInboxRemoveDone } from './sync/inbox-done';
import { spToMd } from './sync/sp-to-md';
import { createSpProject } from './sync/missing-resource';
import { planReconcile } from './projects/reconcile';
import { runProjectsReconcile } from './projects/reconcile-run';
import { matchFoldersToProjects } from './projects/project-dir';
import { findDeletedFolders, findRemovedProjectFolders } from './projects/folder-delete';
import type { DeletedFolder } from './projects/folder-delete';
import { showDeletedFolderDialog } from './projects/folder-delete-dialog';
import { showCreateProjectDialog } from './projects/create-project-dialog';
import { showRenameDialog, type RenameKind } from './projects/rename-dialog';
import { showCreateFolderDialog } from './projects/create-folder-dialog';

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
    log.error('[sync-md] Failed to cache projects:', err);
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
      label: `Vault Bridge: Update available (v${info.latestVersion})`,
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
    log.error('[sync-md] registerHeaderButton (upgrade) failed:', err);
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
        msg: `Vault Bridge: version ${info.latestVersion} available`,
        type: 'INFO',
        ico: 'upgrade',
      });
    } catch (err) {
      log.error('[sync-md] update snack failed:', err);
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
    log.error('[sync-md] update check error:', err);
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
// Deleted-folder questions already shown this session, by project id. Cleared on
// restart, so an unanswered question comes back then.
const askedDeletedFolders = new Set<string>();

// Folders without an SP project already asked about this session. Cleared on restart,
// so a "Keep for now" answer comes back then.
const askedNewFolders = new Set<string>();

// Ask in SP before creating a project for a new folder. Create makes the project;
// Ignore adds the folder to the excluded list so it is not asked about again.
const askAboutNewFolder = (folder: string): void => {
  if (askedNewFolders.has(folder)) return;
  askedNewFolders.add(folder);
  void showCreateProjectDialog(folder, {
    onCreate: async () => {
      try {
        await createSpProject(folder);
        log.log(`created SP project "${folder}"`);
        void startBindings();
      } catch (err) {
        log.error(`could not create SP project "${folder}"`, err);
      }
    },
    onIgnore: () => {
      const dirCfg = resolveProjectsDirCfg(currentConfig.projectsDir);
      currentConfig = { ...currentConfig, projectsDir: { ...dirCfg, excluded: ignoreRow(dirCfg.excluded, folder) } };
      persistConfig();
      log.log(`ignoring folder "${folder}"`);
      void startBindings();
    },
  });
};

interface PendingRename {
  kind: RenameKind;
  projectId: string;
  from: string;
  to: string;
}

// Renames already asked about this session. Cleared on restart, so "Keep for now" comes back then.
const askedRenames = new Set<string>();

// Ask in SP before a rename. Rename applies it on both sides and records the new name
// as the link; nothing is renamed without that button.
const askAboutRename = (r: PendingRename, absDir: string): void => {
  const key = `${r.kind}:${r.projectId}:${r.from}>${r.to}`;
  if (askedRenames.has(key)) return;
  askedRenames.add(key);
  void showRenameDialog(r.kind, r.from, r.to, {
    onRename: async () => {
      try {
        if (r.kind === 'folder') await renameSubfolder(absDir, r.from, r.to);
        else await PluginAPI.updateProject(r.projectId, { title: r.to });
        currentConfig = {
          ...currentConfig,
          _projectLinks: { ...(currentConfig._projectLinks ?? {}), [r.projectId]: r.to },
        };
        persistConfig();
        log.log(`renamed ${r.kind === 'folder' ? 'folder' : 'SP project'} "${r.from}" → "${r.to}"`);
        void startBindings();
      } catch (err) {
        log.error(`could not rename "${r.from}" to "${r.to}"`, err);
      }
    },
    // Keep both names. The folder that exists now is bound to the project by name, so
    // the two stay linked as they are and the rename is not asked again.
    onIgnore: () => {
      const folder = r.kind === 'folder' ? r.from : r.to;
      const dirCfg = resolveProjectsDirCfg(currentConfig.projectsDir);
      const binds: Record<string, string> = {};
      for (const [k, v] of Object.entries(dirCfg.folderBinds ?? {})) {
        if (k !== folder && v !== r.projectId) binds[k] = v;
      }
      binds[folder] = r.projectId;
      // The link must name the folder the project is bound to. A stale link to the other
      // name makes the sync treat the project as folder-less and create a second folder.
      currentConfig = {
        ...currentConfig,
        projectsDir: { ...dirCfg, folderBinds: binds },
        _projectLinks: { ...(currentConfig._projectLinks ?? {}), [r.projectId]: folder },
      };
      persistConfig();
      log.log(`kept "${r.from}" and "${r.to}" as they are, bound folder "${folder}"`);
      void startBindings();
    },
  });
};

// Projects without a folder already asked about this session, by project id.
const askedProjectFolders = new Set<string>();

// Ask in SP before creating the folder and task file for a project. Create writes them;
// Ignore adds the project's name to the excluded list so it is not asked about again.
const askAboutNewProjectFolder = (projectTitle: string, binding: SyncBindingCfg): void => {
  if (askedProjectFolders.has(binding.projectId)) return;
  askedProjectFolders.add(binding.projectId);
  void showCreateFolderDialog(projectTitle, resolveProjectsDirCfg(currentConfig.projectsDir).taskFileName, {
    onCreate: async () => {
      try {
        await assertRealPathInside(effectiveVaultPath(currentConfig), binding.filePath);
        await spToMd(binding);
        log.log(`created folder + task file for "${projectTitle}"`);
        void startBindings();
      } catch (err) {
        log.error(`could not create folder for "${projectTitle}"`, err);
      }
    },
    onIgnore: () => {
      const dirCfg = resolveProjectsDirCfg(currentConfig.projectsDir);
      currentConfig = { ...currentConfig, projectsDir: { ...dirCfg, excluded: ignoreRow(dirCfg.excluded, projectTitle) } };
      persistConfig();
      log.log(`ignoring project "${projectTitle}" for folder sync`);
      void startBindings();
    },
  });
};

// Ask in SP what to do with a project whose linked folder was deleted. A dry-run only
// logs. Unlink keeps the project and stops its folder from being created again.
// Remove deletes the project (and its tasks) only after the user presses that button.
const askAboutDeletedFolder = (deleted: DeletedFolder, title: string, writeMode: boolean): void => {
  if (askedDeletedFolders.has(deleted.projectId)) return;
  if (!writeMode) {
    log.log(`would ask what to do with deleted folder "${deleted.folder}" (project "${title}")`);
    return;
  }
  askedDeletedFolders.add(deleted.projectId);
  void showDeletedFolderDialog(deleted.folder, title, {
    onUnlink: () => {
      const links = { ...(currentConfig._projectLinks ?? {}) };
      delete links[deleted.projectId];
      const unlinked = [...new Set([...(currentConfig._unlinkedProjectIds ?? []), deleted.projectId])];
      currentConfig = { ...currentConfig, _projectLinks: links, _unlinkedProjectIds: unlinked };
      persistConfig();
      log.log(`unlinked "${title}" (folder "${deleted.folder}" was deleted)`);
      void startBindings();
    },
    onRemoveProject: async () => {
      const api = PluginAPI as unknown as { deleteProject?: (id: string) => Promise<void> };
      if (typeof api.deleteProject !== 'function') {
        PluginAPI.showSnack({ msg: 'Vault Bridge: removing a project is not available in this SP version', type: 'ERROR' });
        return;
      }
      try {
        await api.deleteProject(deleted.projectId);
        log.log(`removed SP project "${title}" (folder "${deleted.folder}" was deleted)`);
        void startBindings();
      } catch (err) {
        log.error(`could not remove SP project "${title}"`, err);
        PluginAPI.showSnack({ msg: `Vault Bridge: could not remove project "${title}"`, type: 'ERROR' });
      }
    },
  });
};

// The Inbox file: tasks in the SP Inbox (no project) are synced with the .md file set in
// the vault section. Off when no file is set. Its real path is checked before it runs.
const inboxBindings = async (vaultPath: string): Promise<SyncBindingCfg[]> => {
  const rel = (currentConfig.inboxFile ?? '').trim();
  if (!rel || !vaultPath) return [];
  if (!validBindFile(rel)) {
    log.error(`Inbox file must be a .md file inside the vault: ${rel}`);
    return [];
  }
  const abs = `${vaultPath.replace(/[\\/]+$/, '')}/${rel}`;
  try {
    await assertRealPathInside(vaultPath, abs);
  } catch (err) {
    log.error('Inbox file not synced:', err);
    return [];
  }
  return [{ id: 'inbox-file', filePath: abs, projectId: INBOX_PROJECT_ID, enabled: true, projectTitle: 'Inbox' }];
};

// Bindings that should run now: the manual list, or the folder-derived list when
// auto mode is on. A failed folder scan starts nothing (see effective-bindings.ts).
// Runs are queued: the folder poll, the debounce and the UI can all call this at once,
// and two overlapping runs would rebuild the registry twice and overwrite each other's config.
const runStartBindings = async (): Promise<void> => {
  const projectsDir = resolveProjectsDirCfg(currentConfig.projectsDir);
  setInboxRemoveDone(currentConfig.inboxRemoveDone === true);
  const vaultPath = effectiveVaultPath(currentConfig);

  // Auto mode: create what is missing on either side. Write mode follows the daily
  // setting (one write switch for the plugin); dry-run only logs.
  if (projectsDir.enabled && vaultPath) {
    try {
      const absDir = `${vaultPath.replace(/[\\/]+$/, '')}/${projectsDir.projectsDir}`;
      await assertRealPathInside(vaultPath, absDir);
      const folders = await listSubfolders(absDir);
      const projects = (await PluginAPI.getAllProjects()).map((p) => ({ id: p.id, title: p.title }));
      const writeMode = !dailyCfg().dryRun;
      const links = currentConfig._projectLinks ?? {};
      // Folders as the last run saw them. A new folder since then is a rename target.
      const previousFolders = currentConfig._knownFolders ?? null;

      // Renames first, so the reconcile below sees the already-renamed folders.
      // Renames are never applied here. Each one is shown in SP and applied only when the
      // user approves it. Until then its project and names are held for this run, so
      // nothing is created, deleted or re-linked because of it.
      // Projects bound by name were kept on purpose ("Ignore"): they are not renamed.
      const boundIds = new Set(Object.values(projectsDir.folderBinds ?? {}));
      const renameLinks = Object.fromEntries(Object.entries(links).filter(([id]) => !boundIds.has(id)));
      const renames = planRenames(renameLinks, folders, projects, previousFolders);
      const pending: PendingRename[] = [
        ...renames.renameFolders.map((r) => ({ kind: 'folder' as const, ...r })),
        ...renames.renameProjects.map((r) => ({ kind: 'project' as const, ...r })),
      ];
      for (const r of pending) {
        log.log(`rename ${r.kind === 'folder' ? 'folder' : 'SP project'} "${r.from}" → "${r.to}"${writeMode ? '' : ' (dry-run)'}`);
        if (writeMode) askAboutRename(r, absDir);
      }
      const heldIds = new Set(pending.map((r) => r.projectId));
      const heldNames = new Set(pending.flatMap((r) => [r.from, r.to]));
      // A project renamed in the vault: its new folder name is not known to the plugin yet.
      const newFolderNames = new Set(renames.renameProjects.map((r) => r.to));
      const knownFolders = folders.filter((f) => !newFolderNames.has(f));

      // Opt-in: a project removed in SP adds its folder name to the excluded list, so the
      // folder is not offered for a new project. Checked before matching, and skipped if
      // the project list came back empty (a failed read must not exclude everything).
      let excluded = projectsDir.excluded;
      if (projectsDir.excludeRemovedProjects && projects.length > 0) {
        const liveIds = new Set(projects.map((p) => p.id));
        for (const r of findRemovedProjectFolders(links, folders, liveIds)) {
          log.log(`project removed in SP, excluding folder "${r.folder}"${writeMode ? '' : ' (dry-run)'}`);
          excluded = ignoreRow(excluded, r.folder);
        }
        if (writeMode && excluded !== projectsDir.excluded) {
          currentConfig = { ...currentConfig, projectsDir: { ...resolveProjectsDirCfg(currentConfig.projectsDir), excluded } };
        }
      }
      // Matched against the folders plus the bound .md files, with the binds applied, so a
      // bound folder or file is not offered for a new project.
      const boundFiles = await boundFilesPresent(vaultPath, absDir, projectsDir.folderBinds ?? {});
      const match = matchFoldersToProjects(
        [...folders, ...boundFiles],
        projects,
        excluded,
        projectsDir.folderBinds ?? {},
      );
      // Opt-in: a linked folder that vanished is a question for the user, not a reason to
      // recreate it. Checked against the folders before this run's renames.
      const projectIds = new Set(projects.map((p) => p.id));
      const deleted = projectsDir.confirmFolderDelete
        ? findDeletedFolders(links, folders, projectIds, heldIds)
        : [];
      for (const d of deleted) {
        askAboutDeletedFolder(d, projects.find((p) => p.id === d.projectId)?.title ?? d.folder, writeMode);
      }
      // Remember folder ↔ project pairs so a later rename can be told apart from a
      // delete + create. Only saved in write mode, so a dry-run changes nothing.
      if (writeMode) {
        const nextLinks: Record<string, string> = {};
        for (const m of match.matched) nextLinks[m.projectId] = m.folder;
        // A deleted folder keeps its link until the user answers the question.
        for (const d of deleted) nextLinks[d.projectId] = d.folder;
        // A pending rename keeps its old link until the user approves it.
        for (const id of heldIds) nextLinks[id] = links[id];
        const matchedIds = new Set(match.matched.map((m) => m.projectId));
        const unlinked = (currentConfig._unlinkedProjectIds ?? []).filter(
          (id) => projectIds.has(id) && !matchedIds.has(id),
        );
        currentConfig = {
          ...currentConfig,
          _projectLinks: nextLinks,
          _unlinkedProjectIds: unlinked,
          _knownFolders: knownFolders,
        };
        persistConfig();
      }
      // Projects still waiting on the deleted-folder question, or unlinked, get no folder.
      const plan = planReconcile(match);
      const held = new Set([
        ...deleted.map((d) => d.projectId),
        ...(currentConfig._unlinkedProjectIds ?? []),
        ...heldIds,
      ]);
      plan.foldersToCreate = plan.foldersToCreate.filter((p) => !held.has(p.id));
      plan.projectsToCreate = plan.projectsToCreate.filter((f) => !heldNames.has(f));
      runProjectsReconcile(plan, absDir, projectsDir.taskFileName, dailyCfg().dryRun, {
        askCreateProject: askAboutNewFolder,
        askCreateFolder: askAboutNewProjectFolder,
      });
    } catch (err) {
      log.error('projects reconcile failed', err);
    }
  }

  const result = await computeEffectiveBindings(
    currentConfig.bindings,
    projectsDir,
    vaultPath,
    {
      listFolders: (dir) =>
        listProjectEntries(effectiveVaultPath(currentConfig), dir, currentConfig.projectsDir?.folderBinds ?? {}),
      getProjects: async () =>
        (await PluginAPI.getAllProjects()).map((p) => ({ id: p.id, title: p.title })),
    },
  );
  const inbox = await inboxBindings(vaultPath);
  if (!result.ok) {
    log.error(`auto project sync not started: ${result.error}`);
    initSyncRegistry(inbox, currentConfig._lastSynced ?? {});
    return;
  }
  // activeBindingsJson tracks the MANUAL list (what the panel edits), not the
  // effective list, so saving the panel does not restart the registry needlessly.
  if (projectsDir.enabled) {
    log.log(`auto project sync: ${result.bindings.length} folder(s) matched`);
    result.bindings.forEach((b) => log.log(`  ↔ ${b.projectTitle} (${b.filePath})`));
  }
  initSyncRegistry([...result.bindings, ...inbox], currentConfig._lastSynced ?? {});
};

const bindingsQueue = createSerialQueue();
const startBindings = (): Promise<void> => bindingsQueue(runStartBindings);

// projectListUpdate can fire several times in a row (e.g. while SP is busy). One
// run after a short quiet period avoids duplicate project creation attempts.
let projectsSyncTimer: ReturnType<typeof setTimeout> | null = null;
const PROJECTS_SYNC_DEBOUNCE_MS = 1500;
const scheduleProjectsSync = (): void => {
  if (projectsSyncTimer) clearTimeout(projectsSyncTimer);
  projectsSyncTimer = setTimeout(() => {
    projectsSyncTimer = null;
    void startBindings();
  }, PROJECTS_SYNC_DEBOUNCE_MS);
};

// Vault → SP renames have no event, so the folder list is polled in auto mode. A
// sync runs only when the folder names change, not on every tick.
const PROJECTS_FOLDER_POLL_MS = 3000;
let stopFolderPoll: (() => void) | null = null;
let lastFolderList: string[] | null = null;
const startFolderPoll = (): void => {
  stopFolderPoll?.();
  stopFolderPoll = null;
  lastFolderList = null;
  const cfg = resolveProjectsDirCfg(currentConfig.projectsDir);
  const vaultPath = effectiveVaultPath(currentConfig);
  if (!cfg.enabled || !vaultPath) return;
  const absDir = `${vaultPath.replace(/[\\/]+$/, '')}/${cfg.projectsDir}`;
  stopFolderPoll = lazySetInterval(async () => {
    try {
      const folders = await listProjectEntries(vaultPath, absDir, cfg.folderBinds ?? {});
      if (folderListChanged(lastFolderList, folders)) {
        lastFolderList = folders;
        await startBindings();
      } else {
        lastFolderList = folders;
      }
    } catch {
      /* folder not readable right now — try again on the next tick */
    }
  }, PROJECTS_FOLDER_POLL_MS);
};

const escapeHtmlText = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Create the missing side of one link row (write mode). Shared by the direct and
// the confirmed path, so both do the same checks.
const handleCreateLinkSide = async (message: any): Promise<{ success: boolean; error?: string; created?: boolean }> => {
  if (resolveDailyNoteCfg(currentConfig.daily).dryRun) {
    return { success: false, error: 'Write mode is off. Turn on writes in Daily Notes to create.' };
  }
  const vault = effectiveVaultPath(currentConfig);
  const dirCfg = resolveProjectsDirCfg(currentConfig.projectsDir);
  const absDir = `${vault.replace(/[\\/]+$/, '')}/${dirCfg.projectsDir}`;
  const name = String(message.name ?? '').trim();
  try {
    if (message.side === 'project') {
      if (!validFolderName(name)) return { success: false, error: 'Invalid project name.' };
      await createSpProject(name);
    } else {
      if (!validFolderName(name)) return { success: false, error: 'Invalid folder name.' };
      const projectId = String(message.projectId ?? '');
      const project = (await PluginAPI.getAllProjects()).find((p) => p.id === projectId);
      if (!project) return { success: false, error: 'SP project not found.' };
      await spToMd({ id: `create-${projectId}`, filePath: `${absDir}/${name}/${dirCfg.taskFileName}`, projectId, enabled: true, projectTitle: name });
    }
    void startBindings();
    return { success: true, created: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
};

// One-time move of saved manual bindings into folder binds. Bindings whose file is
// inside the projects folder become binds; the rest are kept so nothing stops syncing.
const migrateBindingsOnce = (): void => {
  const dirCfg = resolveProjectsDirCfg(currentConfig.projectsDir);
  const vault = effectiveVaultPath(currentConfig);
  if (!vault || (currentConfig.bindings ?? []).length === 0) return;
  const absDir = `${vault.replace(/[\\/]+$/, '')}/${dirCfg.projectsDir}`;
  const { folderBinds, kept } = migrateManualBindings(currentConfig.bindings, absDir);
  if (Object.keys(folderBinds).length === 0) return;
  currentConfig = {
    ...currentConfig,
    bindings: kept,
    projectsDir: { ...dirCfg, folderBinds: { ...(dirCfg.folderBinds ?? {}), ...folderBinds } },
  };
  persistConfig();
  log.log(`migrated ${Object.keys(folderBinds).length} binding(s) into project folder binds; ${kept.length} kept`);
};

const applyConfigFromUi = (incoming: LocalUserCfgV2): void => {
  try {
    const newBindingsJson = JSON.stringify(incoming?.bindings ?? []);
    const bindingsChanged = newBindingsJson !== activeBindingsJson;
    currentConfig = mergeUiConfig(currentConfig, incoming);
    persistConfig();
    if (bindingsChanged) {
      activeBindingsJson = newBindingsJson;
      log.log('[sync-md] Config saved from UI — restarting sync registry');
      void startBindings();
    }
  } catch (err) {
    log.error('[sync-md] Failed to apply config from UI:', err);
  }
};

// Daily settings with the shared vault path applied, so the daily code never reads
// a second copy of the vault path.
const dailyCfg = () => ({
  ...resolveDailyNoteCfg(currentConfig.daily),
  vaultPath: effectiveVaultPath(currentConfig),
});

const watchDailyNote = (path: string, onChange: () => void) =>
  startFileWatcher(path, onChange, { notifyOnCreate: true });

// Baseline storage for the daily-note sync (device-local, saved with the config).
const dailyDeps = () => ({
  getBaseline: () => currentConfig._dailyBaseline ?? {},
  getBaselineDay: () => currentConfig._dailyBaselineDay,
  getRolloverDay: () => currentConfig._dailyRolloverDay,
  saveRolloverDay: (day: string) => {
    currentConfig = { ...currentConfig, _dailyRolloverDay: day };
    persistConfig();
  },
  saveBaseline: (baseline: NonNullable<LocalUserCfgV2['_dailyBaseline']>, day: string) => {
    currentConfig = { ...currentConfig, _dailyBaseline: baseline, _dailyBaselineDay: day };
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
      label: 'Vault Bridge',
      icon: 'arrows_up_down_circle',
      onClick: () => {
        PluginAPI.showIndexHtmlAsView();
      },
    });
  } catch (err) {
    log.error('[sync-md] registerMenuEntry failed:', err);
  }

  try {
    PluginAPI.registerHeaderButton({
      label: 'Vault Bridge: Sync Now',
      icon: 'arrows_up_down_circle',
      onClick: () => {
        syncAllNow();
        PluginAPI.showSnack({ msg: 'Vault Bridge: bidirectional sync triggered', type: 'INFO' });
      },
    });
  } catch (err) {
    log.error('[sync-md] registerHeaderButton failed:', err);
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
        log.log('[sync-md] Migrated config from synced storage to local storage');
      }
      // Clear the legacy synced blob so it stops propagating across devices.
      try {
        await PluginAPI.persistDataSynced('');
      } catch (err) {
        log.error('[sync-md] Failed to clear legacy synced config:', err);
      }
    }
  } catch {
    /* no legacy synced data (or API unavailable) — nothing to migrate */
  }

  // Daily notes: dry-run only, and only when the user has enabled it.
  startDailyNoteWatcher(() => dailyCfg(), dailyDeps(), watchDailyNote);
  void runDailyNoteDryRun(dailyCfg(), dailyDeps()).catch((err) =>
    log.error('daily dry-run failed', err),
  );
  // At midnight the note path changes: follow the new day's note.
  startDayChangeCheck(() => {
    startDailyNoteWatcher(() => dailyCfg(), dailyDeps(), watchDailyNote);
    void runDailyNoteDryRun(dailyCfg(), dailyDeps()).catch((err) =>
      log.error('daily dry-run failed', err),
    );
  });

  migrateBindingsOnce();
  activeBindingsJson = JSON.stringify(currentConfig?.bindings ?? []);
  // The Inbox file counts too: an Inbox-only setup must sync again after a restart.
  const hasInboxFile = (currentConfig.inboxFile ?? '').trim() !== '';
  if (resolveProjectsDirCfg(currentConfig.projectsDir).enabled || (currentConfig?.bindings?.length ?? 0) > 0 || hasInboxFile) {
    await startBindings();
  }
  startFolderPoll();

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
      if (type === 'saveProjectsDir') {
        const result = validateProjectsDirCfg(message.projectsDir ?? {});
        if (!result.ok) return { success: false, error: result.error };
        currentConfig = { ...currentConfig, projectsDir: result.cfg };
        persistConfig();
        // Auto mode changes which bindings run, so restart the registry now.
        log.log('Projects settings saved — restarting sync registry');
        void startBindings();
        startFolderPoll();
        return { success: true, projectsDir: result.cfg };
      }
      if (type === 'getLinkTable') {
        const vault = effectiveVaultPath(currentConfig);
        const dirCfg = resolveProjectsDirCfg(currentConfig.projectsDir);
        if (!vault) return { success: false, error: 'Set the vault path first.' };
        try {
          const absDir = `${vault.replace(/[\\/]+$/, '')}/${dirCfg.projectsDir}`;
          const entries = await listProjectEntries(vault, absDir, dirCfg.folderBinds ?? {});
          const projects = (await PluginAPI.getAllProjects()).map((p) => ({ id: p.id, title: p.title }));
          return { success: true, rows: buildLinkTable(entries, projects, dirCfg.excluded, dirCfg.folderBinds ?? {}) };
        } catch (err) {
          return { success: false, error: err instanceof Error ? err.message : String(err) };
        }
      }
      if (type === 'confirmCreateLinkSide') {
        // Show an SP confirmation first. Nothing is created until its button is
        // pressed. The plugin API cannot return typed text, so the name comes from the
        // panel and this dialog only confirms it.
        const side = message.side === 'project' ? 'project' : 'folder';
        const name = String(message.name ?? '').trim();
        if (!validFolderName(name)) return { success: false, error: 'Invalid name.' };
        const api = PluginAPI as unknown as { openDialog?: (cfg: any) => Promise<void> };
        if (typeof api.openDialog !== 'function') {
          return { success: false, error: 'SP dialogs are not available in this version.' };
        }
        let confirmed = false;
        await api.openDialog({
          title: side === 'project' ? 'Create SP project?' : 'Create folder?',
          htmlContent:
            `<p>Create the ${side} <strong>${escapeHtmlText(name)}</strong>` +
            (side === 'folder' ? ' with a task file' : ' in Super Productivity') + '?</p>',
          buttons: [
            { label: 'Create', color: 'primary', onClick: () => { confirmed = true; } },
            { label: 'Cancel' },
          ],
        });
        if (!confirmed) return { success: true, created: false };
        return handleCreateLinkSide({ side, name, projectId: message.projectId });
      }
      if (type === 'createLinkSide') {
        return handleCreateLinkSide(message);
      }
      if (type === 'setFolderBind') {
        // Manually link a markdown file (inside the projects folder) to an SP project.
        // Pass projectId null to clear the bind for that file.
        const dirCfg = resolveProjectsDirCfg(currentConfig.projectsDir);
        const file = String(message.file ?? '').trim();
        const projectId = message.projectId ? String(message.projectId) : null;
        if (!validBindFile(file)) return { success: false, error: 'Choose a .md file inside the projects folder.' };
        const binds = { ...(dirCfg.folderBinds ?? {}) };
        if (projectId === null) {
          delete binds[file];
        } else {
          const project = (await PluginAPI.getAllProjects()).find((p) => p.id === projectId);
          if (!project) return { success: false, error: 'SP project not found.' };
          // A project can be bound to one file only; the old bind for it is dropped.
          for (const k of Object.keys(binds)) if (binds[k] === projectId) delete binds[k];
          binds[file] = projectId;
        }
        currentConfig = { ...currentConfig, projectsDir: { ...dirCfg, folderBinds: binds } };
        persistConfig();
        void startBindings();
        startFolderPoll();
        return { success: true, folderBinds: binds };
      }
      if (type === 'setLinkOverride') {
        // Ignore/unignore changes the excluded list, which both sides already honour.
        const dirCfg = resolveProjectsDirCfg(currentConfig.projectsDir);
        const name = String(message.name ?? '').trim();
        if (!name) return { success: false, error: 'Missing name.' };
        const excluded = message.ignore ? ignoreRow(dirCfg.excluded, name) : unignoreRow(dirCfg.excluded, name);
        currentConfig = { ...currentConfig, projectsDir: { ...dirCfg, excluded } };
        persistConfig();
        void startBindings();
        startFolderPoll();
        return { success: true, excluded };
      }
      if (type === 'saveVaultPath') {
        const result = validateVaultPath(message.path);
        if (!result.ok) return { success: false, error: result.error };
        // The Inbox file is optional and saved with the vault. Empty turns it off.
        let inboxFile = currentConfig.inboxFile;
        if (message.inboxFile !== undefined) {
          const rel = String(message.inboxFile ?? '').trim();
          if (rel && !validBindFile(rel)) return { success: false, error: 'Inbox file must be a .md file inside the vault.' };
          inboxFile = rel || undefined;
        }
        const removeDone = message.inboxRemoveDone !== undefined ? message.inboxRemoveDone === true : currentConfig.inboxRemoveDone === true;
        const inboxChanged =
          inboxFile !== currentConfig.inboxFile ||
          removeDone !== (currentConfig.inboxRemoveDone === true) ||
          result.path !== currentConfig.vaultPath;
        currentConfig = { ...currentConfig, vaultPath: result.path, inboxFile, inboxRemoveDone: removeDone };
        persistConfig();
        startFolderPoll();
        // The daily note lives under the vault, so the watcher must follow the new path.
        startDailyNoteWatcher(() => dailyCfg(), dailyDeps(), watchDailyNote);
        if (inboxChanged) void startBindings();
        return { success: true, path: result.path, inboxFile: inboxFile ?? '' };
      }
      if (type === 'saveDailySettings') {
        // The panel does not send a vault path: the daily note uses the shared one.
        const result = validateDailySettings({ ...message.daily, vaultPath: effectiveVaultPath(currentConfig) });
        if (!result.ok) return { success: false, error: result.error };
        currentConfig = { ...currentConfig, daily: result.cfg };
        persistConfig();
        // Restart the watcher so it follows the new folder or filename format.
        startDailyNoteWatcher(() => dailyCfg(), dailyDeps(), watchDailyNote);
        return { success: true, daily: result.cfg };
      }
      if (type === 'getProjects') {
        await refreshProjectsCache();
        return { success: true, projects: currentConfig._cachedProjects ?? [] };
      }
      return { success: false, error: 'unknown message type' };
    });
  } else {
    log.error('[sync-md] onMessage unavailable — config panel cannot load/save');
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
      if (projectsSyncTimer) clearTimeout(projectsSyncTimer);
      stopFolderPoll?.();
      stopDailyNoteWatcher();
      stopDayChangeCheck();
      shutdownSyncRegistry();
      log.log('[sync-md] onUnload: timers + sessions torn down');
    });
  } else {
    log.error('[sync-md] onUnload not available — reloads may leave zombie timers');
  }

  // projectListUpdate: fired when the user adds, renames, or removes a project.
  // Refresh the cache so the fallback path in loadProjects() has up-to-date data.
  PluginAPI.registerHook('projectListUpdate' as any, () => {
    void refreshProjectsCache();
    // Auto mode: a new SP project should get its folder + task file without a restart.
    if (resolveProjectsDirCfg(currentConfig.projectsDir).enabled) scheduleProjectsSync();
  });

  // Daily notes: re-run after task edits (debounced). Gated by daily.enabled in
  // the runner, so this is a no-op while the feature is off.
  PluginAPI.registerHook('taskUpdate' as any, () =>
    scheduleDailyNoteRun(() => dailyCfg(), dailyDeps()),
  );

  // A new task (`[Task] Add Task`) fires no taskUpdate, so it would only reach the note on
  // the next check. The action hook sees it; only structural task actions schedule a run.
  PluginAPI.registerHook('action' as any, (...args: unknown[]) => {
    const raw = args[0] as { type?: string; action?: { type?: string } } | undefined;
    const type = raw?.type ?? raw?.action?.type;
    if (typeof type === 'string' && isStructuralTaskAction(type)) {
      scheduleDailyNoteRun(() => dailyCfg(), dailyDeps());
    }
  });

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
