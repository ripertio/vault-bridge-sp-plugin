import { initSyncRegistry, setConfigBridge, _resetForTesting } from '../../sync/sync-manager';
import { SyncBindingCfg } from '../../local-config';
import * as fileWatcher from '../../sync/file-watcher';
import * as fileUtils from '../../helper/file-utils';
import { spToMd } from '../../sync/sp-to-md';
import { mdToSp } from '../../sync/md-to-sp';
import { verifySyncState, logSyncVerification } from '../../sync/verify-sync';
import { showMissingFileDialog } from '../../sync/missing-resource';

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

describe('Sync Manager — missing .md file policy (case 3a)', () => {
  const config: SyncBindingCfg = {
    id: 'b1',
    filePath: '/test/tasks.md',
    projectId: 'p1',
    enabled: true,
  };

  let bridge: {
    reportSynced: jest.Mock;
    deleteBinding: jest.Mock;
    repointBinding: jest.Mock;
    updateBindingTitle: jest.Mock;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    _resetForTesting(); // clear module-level dialog/cooldown/recreate state

    // Default: file is MISSING (getFileStats null, readTasksFile null on ENOENT).
    (fileUtils.getFileStats as jest.Mock).mockResolvedValue(null);
    (fileUtils.readTasksFile as jest.Mock).mockResolvedValue(null);
    (spToMd as jest.Mock).mockResolvedValue(undefined);
    (mdToSp as jest.Mock).mockResolvedValue(undefined);
    (verifySyncState as jest.Mock).mockResolvedValue({ isInSync: true, differences: [] });
    (logSyncVerification as jest.Mock).mockReturnValue(undefined);
    (fileWatcher.startFileWatcher as jest.Mock).mockReturnValue(jest.fn());
    // Default dialog behaviour: user does nothing (Ignore).
    (showMissingFileDialog as jest.Mock).mockResolvedValue(undefined);

    bridge = {
      reportSynced: jest.fn(),
      deleteBinding: jest.fn(),
      repointBinding: jest.fn(),
      updateBindingTitle: jest.fn(),
    };
    setConfigBridge(bridge);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('brand-new binding with no file: creates it silently, no dialog', async () => {
    // lastSynced empty → hasSyncedBefore false.
    initSyncRegistry([config], {});
    await jest.runAllTimersAsync();

    expect(spToMd).toHaveBeenCalledWith(config);
    expect(showMissingFileDialog).not.toHaveBeenCalled();
    expect(bridge.reportSynced).toHaveBeenCalledWith('b1', expect.any(String));
  });

  it('previously-synced binding with missing file: shows the dialog, does not recreate silently', async () => {
    // lastSynced has this binding → hasSyncedBefore true.
    initSyncRegistry([config], { b1: '2026-07-06T10:00:00.000Z' });
    await jest.runAllTimersAsync();

    expect(showMissingFileDialog).toHaveBeenCalledWith(
      '/test/tasks.md',
      expect.objectContaining({
        onRecreate: expect.any(Function),
        onDelete: expect.any(Function),
        onIgnore: expect.any(Function),
      }),
    );
    expect(spToMd).not.toHaveBeenCalled();
    expect(bridge.reportSynced).not.toHaveBeenCalled();
  });

  it('Recreate choice: writes SP→MD, reports sync, shows success snack', async () => {
    (showMissingFileDialog as jest.Mock).mockImplementation(
      async (_path: string, h: any) => {
        await h.onRecreate();
      },
    );

    initSyncRegistry([config], { b1: '2026-07-06T10:00:00.000Z' });
    await jest.runAllTimersAsync();

    expect(spToMd).toHaveBeenCalledWith(config);
    expect(bridge.reportSynced).toHaveBeenCalledWith('b1', expect.any(String));
    expect(PluginAPI.showSnack).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'SUCCESS' }),
    );
  });

  it('Delete choice: requests binding deletion via the config bridge', async () => {
    (showMissingFileDialog as jest.Mock).mockImplementation(
      async (_path: string, h: any) => {
        h.onDelete();
      },
    );

    initSyncRegistry([config], { b1: '2026-07-06T10:00:00.000Z' });
    await jest.runAllTimersAsync();

    expect(bridge.deleteBinding).toHaveBeenCalledWith('b1');
    expect(spToMd).not.toHaveBeenCalled();
  });

  it('file present with tasks: normal initial sync reports a successful sync', async () => {
    (fileUtils.getFileStats as jest.Mock).mockResolvedValue({ mtime: new Date() });
    (fileUtils.readTasksFile as jest.Mock).mockResolvedValue('- [ ] Task <!--id-->');

    initSyncRegistry([config], {});
    await jest.runAllTimersAsync();

    expect(mdToSp).toHaveBeenCalled();
    expect(showMissingFileDialog).not.toHaveBeenCalled();
    expect(bridge.reportSynced).toHaveBeenCalledWith('b1', expect.any(String));
  });
});
