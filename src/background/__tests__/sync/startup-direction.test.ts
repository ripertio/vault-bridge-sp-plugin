import { initSyncRegistry, setConfigBridge, _resetForTesting } from '../../sync/sync-manager';
import { SyncBindingCfg } from '../../local-config';
import * as fileWatcher from '../../sync/file-watcher';
import * as fileUtils from '../../helper/file-utils';
import { hashContent } from '../../helper/hash';
import { spToMd } from '../../sync/sp-to-md';
import { mdToSp } from '../../sync/md-to-sp';
import { verifySyncState, logSyncVerification } from '../../sync/verify-sync';

jest.mock('../../sync/file-watcher');
jest.mock('../../helper/file-utils');
jest.mock('../../sync/sp-to-md');
jest.mock('../../sync/md-to-sp');
jest.mock('../../sync/verify-sync');
jest.mock('../../sync/missing-resource');
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

(global as any).PluginAPI = {
  registerHook: jest.fn(),
  onWindowFocusChange: jest.fn(),
  persistDataSynced: jest.fn(),
  loadSyncedData: jest.fn(),
  showSnack: jest.fn(),
};

// A start decides the direction from the file's fingerprint: SP has just run its own
// Dropbox / SuperSync sync, so a file nobody edited must not be imported over it.
describe('Sync Manager — startup direction', () => {
  const config: SyncBindingCfg = { id: 'b1', filePath: '/test/tasks.md', projectId: 'p1', enabled: true };
  const content = '- [ ] Task <!--id-->';
  const lastSynced = { b1: '2026-07-06T10:00:00.000Z' };
  let bridge: { reportSynced: jest.Mock; deleteBinding: jest.Mock; repointBinding: jest.Mock; updateBindingTitle: jest.Mock; reportFileHashes: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    _resetForTesting();
    (fileUtils.getFileStats as jest.Mock).mockResolvedValue({ mtime: new Date() });
    (fileUtils.readTasksFile as jest.Mock).mockResolvedValue(content);
    (spToMd as jest.Mock).mockResolvedValue(undefined);
    (mdToSp as jest.Mock).mockResolvedValue('ok');
    (verifySyncState as jest.Mock).mockResolvedValue({ isInSync: true, differences: [] });
    (logSyncVerification as jest.Mock).mockReturnValue(undefined);
    (fileWatcher.startFileWatcher as jest.Mock).mockReturnValue(jest.fn());
    bridge = {
      reportSynced: jest.fn(),
      deleteBinding: jest.fn(),
      repointBinding: jest.fn(),
      updateBindingTitle: jest.fn(),
      reportFileHashes: jest.fn(),
    };
    setConfigBridge(bridge);
  });

  afterEach(() => jest.useRealTimers());

  it('file unchanged since the last sync: SP wins, nothing is imported', async () => {
    initSyncRegistry([config], lastSynced, { '/test/tasks.md': hashContent(content) });
    await jest.runAllTimersAsync();

    expect(mdToSp).not.toHaveBeenCalled();
    expect(spToMd).toHaveBeenCalled();
    expect(bridge.reportSynced).toHaveBeenCalledWith('b1', expect.any(String));
  });

  it('file edited since the last sync: the edit is imported', async () => {
    initSyncRegistry([config], lastSynced, { '/test/tasks.md': hashContent('- [ ] Older <!--id-->') });
    await jest.runAllTimersAsync();

    expect(mdToSp).toHaveBeenCalled();
  });

  it('no stored fingerprint (first start after the update): imports, as before', async () => {
    initSyncRegistry([config], lastSynced, {});
    await jest.runAllTimersAsync();

    expect(mdToSp).toHaveBeenCalled();
  });

  it('records the fingerprint after a sync so the next start can compare', async () => {
    initSyncRegistry([config], lastSynced, {});
    await jest.runAllTimersAsync();

    expect(bridge.reportFileHashes).toHaveBeenCalledWith({ '/test/tasks.md': hashContent(content) });
  });

  it('multi-file project: one edited file means the whole project is imported', async () => {
    const group: SyncBindingCfg = { ...config, groupPaths: ['/test/tasks.md', '/test/extra.md'] };
    (fileUtils.readTasksFile as jest.Mock).mockImplementation(async (p: string) =>
      p === '/test/tasks.md' ? content : '- [ ] Edited <!--x-->',
    );
    initSyncRegistry([group], lastSynced, {
      '/test/tasks.md': hashContent(content),
      '/test/extra.md': hashContent('- [ ] Before <!--x-->'),
    });
    await jest.runAllTimersAsync();

    expect(mdToSp).toHaveBeenCalled();
  });
});
