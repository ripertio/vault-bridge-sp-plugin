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
const LOCAL_STORAGE_KEY = 'sync-md-multi-config';

export const loadLocalConfig = (): LocalUserCfgV2 => {
  try {
    const savedData = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (savedData) {
      const parsed = JSON.parse(savedData);
      
      // Migration logic: V1 to V2
      if (!parsed.version || parsed.version === 1 || (!parsed.bindings && parsed.filePath)) {
        console.log('[sync-md-multi] Migrating legacy config to V2');
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
    console.error('[sync-md-multi] Failed to load config:', error);
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
    console.error('[sync-md-multi] Failed to save config:', error);
  }
};
