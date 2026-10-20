import { initSyncRegistry, setConfigBridge, _resetForTesting } from '../../sync/sync-manager';
import { SyncBindingCfg } from '../../local-config';
import * as fileWatcher from '../../sync/file-watcher';
import * as fileUtils from '../../helper/file-utils';
import { spToMd } from '../../sync/sp-to-md';
import { mdToSp } from '../../sync/md-to-sp';
import { verifySyncState, logSyncVerification } from '../../sync/verify-sync';
import {
  showMissingProjectDialog,
  showMissingFileDialog,
  createSpProject,
} from '../../sync/missing-resource';

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
  getAllProjects: jest.fn(),
};

describe('Sync Manager — deleted SP project policy (case 3b)', () => {
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

    // Default: project p1 is MISSING (not in the list), file present with tasks.
    (PluginAPI.getAllProjects as jest.Mock).mockResolvedValue([{ id: 'other' }]);
    (fileUtils.getFileStats as jest.Mock).mockResolvedValue({ mtime: new Date() });
    (fileUtils.readTasksFile as jest.Mock).mockResolvedValue('- [ ] <!--id--> Task');
    (spToMd as jest.Mock).mockResolvedValue(undefined);
    (mdToSp as jest.Mock).mockResolvedValue(undefined);
    (verifySyncState as jest.Mock).mockResolvedValue({ isInSync: true, differences: [] });
    (logSyncVerification as jest.Mock).mockReturnValue(undefined);
    (fileWatcher.startFileWatcher as jest.Mock).mockReturnValue(jest.fn());
    (createSpProject as jest.Mock).mockResolvedValue('p2');
    // Default dialog behaviour: user does nothing.
    (showMissingProjectDialog as jest.Mock).mockResolvedValue(undefined);
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

  it('project missing, file present: shows the dialog with canRecreate=true, no silent sync', async () => {
    initSyncRegistry([config], {});
    await jest.runAllTimersAsync();

    expect(showMissingProjectDialog).toHaveBeenCalledWith(
      '/test/tasks.md',
      expect.objectContaining({
        onRecreate: expect.any(Function),
        onDelete: expect.any(Function),
      }),
      true, // canRecreate — the .md exists as a source
      undefined, // no stored title on this binding
    );
    // No recreate/delete chosen → nothing mutated.
    expect(createSpProject).not.toHaveBeenCalled();
    expect(spToMd).not.toHaveBeenCalled();
    expect(bridge.reportSynced).not.toHaveBeenCalled();
  });

  it('project AND file missing: dialog offered with canRecreate=false', async () => {
    (fileUtils.getFileStats as jest.Mock).mockResolvedValue(null);

    initSyncRegistry([config], {});
    await jest.runAllTimersAsync();

    expect(showMissingProjectDialog).toHaveBeenCalledWith(
      '/test/tasks.md',
      expect.anything(),
      false, // no source to recreate from
      undefined, // no stored title on this binding
    );
  });

  it('Recreate choice: creates project, re-points binding, imports and writes back', async () => {
    // p1 absent (triggers dialog); p2 present so waitForProjectVisible resolves.
    (PluginAPI.getAllProjects as jest.Mock).mockResolvedValue([{ id: 'p2' }]);
    (showMissingProjectDialog as jest.Mock).mockImplementation(
      async (_path: string, h: any) => {
        await h.onRecreate();
      },
    );

    initSyncRegistry([config], {});
    await jest.runAllTimersAsync();

    expect(createSpProject).toHaveBeenCalledWith('tasks'); // basename of tasks.md
    expect(bridge.repointBinding).toHaveBeenCalledWith('b1', 'p2');
    // Stale task ids are stripped before reimport → tasks created anew.
    expect(mdToSp).toHaveBeenCalledWith('- [ ] Task', 'p2');
    expect(spToMd).toHaveBeenCalled();
    expect(bridge.reportSynced).toHaveBeenCalledWith('b1', expect.any(String));
    expect(PluginAPI.showSnack).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'SUCCESS' }),
    );
  });

  it('Delete choice: requests binding deletion, does not recreate', async () => {
    (showMissingProjectDialog as jest.Mock).mockImplementation(
      async (_path: string, h: any) => {
        h.onDelete();
      },
    );

    initSyncRegistry([config], {});
    await jest.runAllTimersAsync();

    expect(bridge.deleteBinding).toHaveBeenCalledWith('b1');
    expect(createSpProject).not.toHaveBeenCalled();
    expect(bridge.repointBinding).not.toHaveBeenCalled();
  });

  it('project present: no dialog, normal sync proceeds', async () => {
    (PluginAPI.getAllProjects as jest.Mock).mockResolvedValue([{ id: 'p1' }]);

    initSyncRegistry([config], {});
    await jest.runAllTimersAsync();

    expect(showMissingProjectDialog).not.toHaveBeenCalled();
    expect(mdToSp).toHaveBeenCalled();
    expect(bridge.reportSynced).toHaveBeenCalledWith('b1', expect.any(String));
  });

  it('project present with a title: captures the last-known title', async () => {
    (PluginAPI.getAllProjects as jest.Mock).mockResolvedValue([{ id: 'p1', title: 'Work' }]);

    initSyncRegistry([config], {});
    await jest.runAllTimersAsync();

    expect(bridge.updateBindingTitle).toHaveBeenCalledWith('b1', 'Work');
  });

  it('dialog receives the stored project title', async () => {
    initSyncRegistry([{ ...config, projectTitle: 'Work' }], {});
    await jest.runAllTimersAsync();

    expect(showMissingProjectDialog).toHaveBeenCalledWith(
      '/test/tasks.md',
      expect.anything(),
      true,
      'Work', // last-known title, shown in the dialog
    );
  });

  it('Recreate uses the stored project title, not the file name', async () => {
    (PluginAPI.getAllProjects as jest.Mock).mockResolvedValue([{ id: 'p2' }]);
    (showMissingProjectDialog as jest.Mock).mockImplementation(
      async (_path: string, h: any) => {
        await h.onRecreate();
      },
    );

    initSyncRegistry([{ ...config, projectTitle: 'Work' }], {});
    await jest.runAllTimersAsync();

    expect(createSpProject).toHaveBeenCalledWith('Work');
  });
});
