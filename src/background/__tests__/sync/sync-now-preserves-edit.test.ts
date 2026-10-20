/**
 * Regression test for the "Sync Now clobbers a fresh Markdown edit" race
 * (reported by @johannesjo in review of super-productivity#9323).
 *
 * The file watcher polls every ~2 s. If the user edits an ID-bearing task line
 * and presses Sync Now inside that window, the pending import has not run yet.
 * syncAllNow used to run SP→MD first unconditionally, which rewrites every
 * ID-bearing line from SP state — destroying the manual edit before it was read.
 *
 * v0.3.0 chose the direction by mtime; the SECOND review (point 4) showed that
 * is still unsafe — an editor that preserves or lowers the file's mtime (atomic
 * replace, restore-from-backup, same-second save) fools the timestamp check and
 * the edit is destroyed. v0.3.1 chooses direction by a CONTENT fingerprint
 * instead. These tests assert the ordering AND that an edit with an equal/older
 * mtime is still detected (mtime is no longer consulted for direction).
 */
import { initSyncRegistry, syncAllNow, _resetForTesting } from '../../sync/sync-manager';
import { SyncBindingCfg } from '../../local-config';

// Mock dependencies (same surface the sync-manager tests mock).
jest.mock('../../sync/file-watcher');
jest.mock('../../sync/sp-to-md');
jest.mock('../../sync/md-to-sp');
jest.mock('../../helper/file-utils');
jest.mock('../../sync/verify-sync');
jest.mock('../../../shared/logger', () => ({
  log: {
    critical: jest.fn(),
    err: jest.fn(),
    error: jest.fn(),
    log: jest.fn(),
    normal: jest.fn(),
    info: jest.fn(),
    verbose: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
  },
}));

import { startFileWatcher } from '../../sync/file-watcher';
import { spToMd } from '../../sync/sp-to-md';
import { mdToSp } from '../../sync/md-to-sp';
import { getFileStats, readTasksFile } from '../../helper/file-utils';
import { verifySyncState, logSyncVerification } from '../../sync/verify-sync';

// The content the file held at the last sync, and after a manual edit.
const CONTENT_AT_LAST_SYNC = '- [x] <!--t1--> Edited @done';
const CONTENT_AFTER_EDIT = '- [x] <!--t1--> Edited @done\n- [ ] a fresh manual line';

// A stable mtime used for BOTH baseline and post-edit reads, to prove the
// direction no longer depends on the timestamp. `divertIfFileMissing` only needs
// this to be truthy (file exists).
const STABLE_MTIME = new Date(1000);

(global as any).PluginAPI = {
  log: { debug: jest.fn(), error: jest.fn(), log: jest.fn() },
  persistDataSynced: jest.fn(),
  loadSyncedData: jest.fn(),
  showSnack: jest.fn(),
  registerHook: jest.fn(),
  onWindowFocusChange: jest.fn(),
  getAllProjects: jest.fn().mockResolvedValue([{ id: 'test-project', title: 'Test' }]),
};

const binding: SyncBindingCfg = {
  id: 'b1',
  filePath: '/test/tasks.md',
  projectId: 'test-project',
  enabled: true,
};

const flush = async (): Promise<void> => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
};

describe('syncAllNow — does not clobber a fresh Markdown edit', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    _resetForTesting();

    (startFileWatcher as jest.Mock).mockReturnValue(() => {});
    (spToMd as jest.Mock).mockResolvedValue(undefined);
    (mdToSp as jest.Mock).mockResolvedValue(undefined);
    (verifySyncState as jest.Mock).mockResolvedValue({ isInSync: true });
    (logSyncVerification as jest.Mock).mockReturnValue(undefined);
    // File exists (truthy stats); the SAME mtime is used before and after the
    // edit, so any direction change is purely content-driven.
    (getFileStats as jest.Mock).mockResolvedValue({ mtime: STABLE_MTIME });
    // Initial sync records the baseline fingerprint from this content.
    (readTasksFile as jest.Mock).mockResolvedValue(CONTENT_AT_LAST_SYNC);

    initSyncRegistry([binding], {});
    await flush();

    // Only observe the manual Sync Now that follows.
    (spToMd as jest.Mock).mockClear();
    (mdToSp as jest.Mock).mockClear();
  });

  it('imports MD→SP first when the file content changed, even with an unchanged mtime', async () => {
    // Edited content, but mtime stays STABLE_MTIME (the mtime-based check would
    // wrongly see "no change" and overwrite the edit).
    (readTasksFile as jest.Mock).mockResolvedValue(CONTENT_AFTER_EDIT);

    syncAllNow();
    await flush();

    expect(mdToSp).toHaveBeenCalled();
    expect(spToMd).toHaveBeenCalled();
    const importOrder = (mdToSp as jest.Mock).mock.invocationCallOrder[0];
    const writeOrder = (spToMd as jest.Mock).mock.invocationCallOrder[0];
    expect(importOrder).toBeLessThan(writeOrder); // edit imported before overwrite
  });

  it('writes SP→MD first when the file content is unchanged since last sync', async () => {
    // Same content as the recorded baseline → no pending edit.
    (readTasksFile as jest.Mock).mockResolvedValue(CONTENT_AT_LAST_SYNC);

    syncAllNow();
    await flush();

    expect(spToMd).toHaveBeenCalled();
    expect(mdToSp).toHaveBeenCalled();
    const writeOrder = (spToMd as jest.Mock).mock.invocationCallOrder[0];
    const importOrder = (mdToSp as jest.Mock).mock.invocationCallOrder[0];
    expect(writeOrder).toBeLessThan(importOrder); // captures hook-less SP changes first
  });
});
