import type { ProjectsDirCfg } from './projects/project-dir';
import type { DailyNoteCfg } from './daily/daily-note';

export interface SyncBindingCfg {
  id: string;
  filePath: string;
  projectId: string;
  enabled: boolean;
  // Last-known SP project title, captured on each sync while the project exists.
  // Used to show the real project name in the "project deleted" dialog and to
  // recreate the project under its original name (SP does not expose the name of
  // an already-deleted project). Falls back to the file name when absent.
  projectTitle?: string;
}

export interface LocalUserCfgV2 {
  version: 2;
  bindings: SyncBindingCfg[];
  // Extra fields persisted alongside the bindings (kept OUT of the bindings
  // array so updating them never changes the bindings JSON, which would trigger
  // a full sync-registry restart in background.ts).
  //  - _cachedProjects: project id/title list for the sandboxed iframe dropdown.
  //  - _lastSynced: last successful sync time per binding id (ISO string). Used
  //    both for the config-UI timestamp and as the "has this binding ever synced"
  //    discriminator that tells a brand-new binding (create the file silently)
  //    apart from a binding whose file was deleted (prompt the user).
  //  - _lastUpdateCheck / _latestVersion / _latestUrl: self-update notifier state
  //    (device-local history — like _lastSynced, it must NOT be treated as shared
  //    config). _lastUpdateCheck records the last check time (informational — the
  //    check runs on every startup + every 24 h, not gated by this); _latestVersion
  //    + _latestUrl let the config-panel footer render the "update available" link
  //    on open without re-hitting the network.
  _cachedProjects?: { id: string; title: string }[];
  _lastSynced?: Record<string, string>;
  _lastUpdateCheck?: string;
  _latestVersion?: string;
  _latestUrl?: string;
  // Vault path shared by daily notes and project folders (absolute).
  vaultPath?: string;
  // Vault-relative .md file that holds the tasks of the SP Inbox (no project). Optional;
  // absent or empty means the Inbox is not synced to a file.
  inboxFile?: string;
  // Off by default. When on, a task that is done in SP is removed from the Inbox file.
  inboxRemoveDone?: boolean;
  // Daily-note settings. Optional so existing configs stay valid; absent means
  // the defaults in daily/daily-note.ts (feature OFF, dry-run ON).
  daily?: Partial<DailyNoteCfg>;
  // Project-folder sync settings (see projects/project-dir.ts). Optional; defaults OFF.
  projectsDir?: Partial<ProjectsDirCfg>;
  // Last state the plugin wrote for each daily-note task (id → done/title). Used
  // to tell which side changed. Device-local, like _lastSynced.
  _dailyBaseline?: Record<string, { isDone: boolean; title: string }>;
  // Day (YYYY-MM-DD) of the note the baseline was saved for.
  _dailyBaselineDay?: string;
  // Day (YYYY-MM-DD) whose overdue tasks were already rolled over into its note.
  _dailyRolloverDay?: string;
  // projectId → folder name for auto project sync. Stable identity for renames.
  _projectLinks?: Record<string, string>;
  // SP project IDs the user unlinked after their folder was deleted. No folder is
  // created for them again while they stay in this list.
  _unlinkedProjectIds?: string[];
  // Folder names as the last sync run saw them. Used to tell a new folder (a rename
  // target) from one that was already there.
  _knownFolders?: string[];
}

// Legacy interface for migration
export interface LocalUserCfgV1 {
  filePath: string;
  projectId: string;
}

// Storage key for local config. Device-local by construction (Electron on-disk
// localStorage, NOT SP-synced): this is what keeps each device's absolute file
// paths / bindings from activating on another synced device (v0.4.0). The key is
// deliberately DISTINCT from the built-in sync.md's own `'sync-md-config'` so the
// two plugins never share or clobber each other's stored config.
const LOCAL_STORAGE_KEY = 'vault-bridge-config';
// Key used before the plugin was renamed from sync-md-multi. Read once when the new
// key is empty, so an existing install keeps its settings.
const PREVIOUS_STORAGE_KEY = 'sync-md-multi-config';

// The old config's update-check state came from the upstream release feed, so it
// must not show an "update available" marker for this plugin.
const fromPreviousKey = (raw: string): string => {
  const parsed = JSON.parse(raw);
  delete parsed._lastUpdateCheck;
  delete parsed._latestVersion;
  delete parsed._latestUrl;
  return JSON.stringify(parsed);
};

export const loadLocalConfig = (): LocalUserCfgV2 => {
  try {
    let savedData = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!savedData) {
      const previous = localStorage.getItem(PREVIOUS_STORAGE_KEY);
      if (previous) {
        savedData = fromPreviousKey(previous);
        localStorage.setItem(LOCAL_STORAGE_KEY, savedData);
        console.log('[vault-bridge] Moved config from the sync-md-multi storage key');
      }
    }
    if (savedData) {
      const parsed = JSON.parse(savedData);

      // Migration logic: V1 to V2
      if (!parsed.version || parsed.version === 1 || (!parsed.bindings && parsed.filePath)) {
        console.log('[vault-bridge] Migrating legacy config to V2');
        const legacy = parsed as LocalUserCfgV1;
        const migrated: LocalUserCfgV2 = {
          version: 2,
          bindings: [
            {
              id: 'default-binding',
              filePath: legacy.filePath,
              projectId: legacy.projectId,
              enabled: true,
            },
          ],
        };
        saveLocalConfig(migrated);
        return migrated;
      }
      
      return parsed as LocalUserCfgV2;
    }
    
    // Default empty config
    return {
      version: 2,
      bindings: [],
    };
  } catch (error) {
    console.error('[vault-bridge] Failed to load config:', error);
    return {
      version: 2,
      bindings: [],
    };
  }
};

export const saveLocalConfig = (config: LocalUserCfgV2): void => {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(config));
  } catch (error) {
    console.error('[vault-bridge] Failed to save config:', error);
  }
};

/**
 * Merge a config pushed from the config panel. The panel manages only `version` and
 * `bindings`; every other field (links, folder state, vault path, daily and projects
 * settings, caches) is kept from the current config. A save with no bindings list keeps
 * the current bindings. Bindings whose project already has a folder bind are dropped:
 * migration moved them there, and a stale panel must not bring them back as duplicates.
 * An explicit empty list clears the bindings. Pure.
 */
export const mergeUiConfig = (
  current: LocalUserCfgV2,
  incoming: Partial<LocalUserCfgV2> | undefined,
): LocalUserCfgV2 => {
  const folderBoundIds = new Set(Object.values(current.projectsDir?.folderBinds ?? {}));
  const bindings = Array.isArray(incoming?.bindings) ? incoming.bindings : current.bindings;
  return {
    ...current,
    version: incoming?.version ?? 2,
    bindings: bindings.filter((b) => !folderBoundIds.has(b.projectId)),
  };
};
