/**
 * Regression test for the follow-up to point 2 (found in SP 18.16.0D testing):
 * when the Markdown file has a parse error, mdToSp aborts (SP untouched) — but
 * the caller used to still run the SP→MD write-back, which rewrote the file
 * from stale SP state and REVERTED the user's in-progress edit (they saw their
 * change disappear and the old title come back).
 *
 * The fix: mdToSp reports `'parse-error'`, and every caller skips the SP→MD
 * write-back so the file is left exactly as the user typed it. This test drives
 * syncAllNow (the Sync Now path) and asserts spToMd is NOT called when mdToSp
 * reports a parse error.
 */
import { initSyncRegistry, syncAllNow, _resetForTesting } from '../../sync/sync-manager';
import { SyncBindingCfg } from '../../local-config';

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

const CONTENT_BASELINE = '- [ ] <!--t1--> Task one';
const CONTENT_MALFORMED = '- [ ] <!--t1-->'; // title removed → parse error

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

describe('parse error → no SP→MD write-back (does not revert the edit)', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    _resetForTesting();

    (startFileWatcher as jest.Mock).mockReturnValue(() => {});
    (spToMd as jest.Mock).mockResolvedValue(undefined);
    (verifySyncState as jest.Mock).mockResolvedValue({ isInSync: false });
    (logSyncVerification as jest.Mock).mockReturnValue(undefined);
    (getFileStats as jest.Mock).mockResolvedValue({ mtime: new Date(1000) });

    // Establish a clean baseline: initial sync imports fine and marks synced.
    (mdToSp as jest.Mock).mockResolvedValue('ok');
    (readTasksFile as jest.Mock).mockResolvedValue(CONTENT_BASELINE);
    initSyncRegistry([binding], {});
    await flush();

    (spToMd as jest.Mock).mockClear();
    (mdToSp as jest.Mock).mockClear();
  });

  it('does not call spToMd when mdToSp reports a parse error', async () => {
    // The user removed the title → the file changed AND mdToSp will abort.
    (readTasksFile as jest.Mock).mockResolvedValue(CONTENT_MALFORMED);
    (mdToSp as jest.Mock).mockResolvedValue('parse-error');

    syncAllNow();
    await flush();

    expect(mdToSp).toHaveBeenCalled(); // the import was attempted…
    expect(spToMd).not.toHaveBeenCalled(); // …but the file is left untouched.
  });

  it('does write back normally when the import succeeds', async () => {
    (readTasksFile as jest.Mock).mockResolvedValue(CONTENT_MALFORMED); // any change
    (mdToSp as jest.Mock).mockResolvedValue('ok');

    syncAllNow();
    await flush();

    expect(mdToSp).toHaveBeenCalled();
    expect(spToMd).toHaveBeenCalled();
  });
});
