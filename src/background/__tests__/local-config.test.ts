/**
 * Tests for the DEVICE-LOCAL config store (v0.4.0, point 1 of the #9323 review).
 *
 * Before v0.4.0 the whole config (absolute file paths + bindings) was persisted
 * via PluginAPI.persistDataSynced, which SP syncs across devices — so a path
 * configured on device A could activate on device B and, against a stale/foreign
 * file, delete tasks and propagate the deletes back. v0.4.0 moves config into the
 * background's OWN localStorage, which is device-local by construction.
 *
 * These tests assert that contract at the storage layer (jsdom provides a real,
 * per-test localStorage):
 *   - saveLocalConfig writes ONLY to localStorage (never to a synced API), under
 *     a key DISTINCT from the built-in sync.md's `'sync-md-config'`;
 *   - a fresh device (empty store) does NOT see another device's bindings — the
 *     cross-device hazard is gone;
 *   - the legacy V1 shape still migrates to V2.
 */
import { loadLocalConfig, saveLocalConfig, LocalUserCfgV2 } from '../local-config';

describe('device-local config store', () => {
  beforeEach(() => {
    localStorage.clear();
    delete (global as any).PluginAPI;
  });

  it('returns an empty V2 config when nothing is stored', () => {
    expect(loadLocalConfig()).toEqual({ version: 2, bindings: [] });
  });

  it('round-trips through localStorage under the sync-md-multi key', () => {
    const cfg: LocalUserCfgV2 = {
      version: 2,
      bindings: [{ id: 'b1', filePath: '/Users/me/tasks.md', projectId: 'p1', enabled: true }],
      _lastSynced: { b1: '2026-07-29T00:00:00.000Z' },
    };
    saveLocalConfig(cfg);

    // Stored under our OWN key, distinct from the built-in sync.md's key so the
    // two plugins can never clobber each other.
    expect(localStorage.getItem('sync-md-multi-config')).not.toBeNull();
    expect(localStorage.getItem('sync-md-config')).toBeNull();

    expect(loadLocalConfig()).toEqual(cfg);
  });

  it('round-trips daily-note settings unchanged', () => {
    const cfg: LocalUserCfgV2 = {
      version: 2,
      bindings: [],
      daily: { enabled: true, dryRun: true, folder: 'Daily', filenameFormat: 'YYYY-MM-DD', includeInbox: false },
    };
    saveLocalConfig(cfg);
    expect(loadLocalConfig()).toEqual(cfg);
  });

  it('does NOT touch any synced-storage API (device-local by construction)', () => {
    const persistDataSynced = jest.fn();
    (global as any).PluginAPI = { persistDataSynced };

    saveLocalConfig({
      version: 2,
      bindings: [{ id: 'b1', filePath: '/a.md', projectId: 'p1', enabled: true }],
    });

    // The whole point of v0.4.0: config never flows through the cross-device store.
    expect(persistDataSynced).not.toHaveBeenCalled();
  });

  it('a fresh device (empty store) does not inherit another device\'s bindings', () => {
    // Device A configures a binding with an absolute path only valid on A.
    saveLocalConfig({
      version: 2,
      bindings: [{ id: 'b1', filePath: '/Users/deviceA/tasks.md', projectId: 'p1', enabled: true }],
    });
    expect(loadLocalConfig().bindings).toHaveLength(1);

    // A different device has its own (empty) localStorage — A's binding is not
    // there to activate. Simulated by an empty store.
    localStorage.clear();
    expect(loadLocalConfig()).toEqual({ version: 2, bindings: [] });
  });

  it('migrates a legacy V1 config (single filePath/projectId) to V2', () => {
    localStorage.setItem(
      'sync-md-multi-config',
      JSON.stringify({ filePath: '/legacy/tasks.md', projectId: 'legacy-project' }),
    );

    const cfg = loadLocalConfig();
    expect(cfg.version).toBe(2);
    expect(cfg.bindings).toEqual([
      { id: 'default-binding', filePath: '/legacy/tasks.md', projectId: 'legacy-project', enabled: true },
    ]);
    // Migration is persisted back, so a reload returns V2 directly.
    expect(JSON.parse(localStorage.getItem('sync-md-multi-config') as string).version).toBe(2);
  });
});
