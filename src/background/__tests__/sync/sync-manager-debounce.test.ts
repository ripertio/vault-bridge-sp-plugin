import { initSyncRegistry, _resetForTesting } from '../../sync/sync-manager';
import { SyncBindingCfg } from '../../local-config';
import * as fileWatcher from '../../sync/file-watcher';
import { SYNC_DEBOUNCE_MS_MD_TO_SP, SYNC_DEBOUNCE_MS } from '../../config.const';
import { PluginHooks } from '@super-productivity/plugin-api';

// Mock dependencies
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

// Import after mocking
import { spToMd } from '../../sync/sp-to-md';
import { mdToSp } from '../../sync/md-to-sp';
import {
  getFileStats,
  readTasksFile,
  ensureDirectoryExists,
} from '../../helper/file-utils';
import { verifySyncState, logSyncVerification } from '../../sync/verify-sync';

// Mock PluginAPI
(global as any).PluginAPI = {
  log: { debug: jest.fn(), error: jest.fn(), log: jest.fn() },
  persistDataSynced: jest.fn(),
  loadSyncedData: jest.fn(),
  showSnack: jest.fn(),
  registerHook: jest.fn(),
  onWindowFocusChange: jest.fn(),
  // The bound project must exist, otherwise the deleted-project policy (3b)
  // diverts the sync to a dialog before the watcher starts.
  getAllProjects: jest.fn().mockResolvedValue([{ id: 'test-project' }]),
};

describe('Sync Manager Debounce Behavior', () => {
  const mockBindings: SyncBindingCfg[] = [{
    id: 'test-binding',
    filePath: '/test/tasks.md',
    projectId: 'test-project',
    enabled: true
  }];

  let mockFileChangeCallback: () => void;
  let mockWindowFocusCallback: (isFocused: boolean) => void;
  const mockSpHooks: Map<string, (event?: any) => void> = new Map();

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    mockSpHooks.clear();
    _resetForTesting();

    (getFileStats as jest.Mock).mockResolvedValue(null);
    (readTasksFile as jest.Mock).mockResolvedValue('- [ ] Test task');
    (ensureDirectoryExists as jest.Mock).mockResolvedValue(undefined);
    (spToMd as jest.Mock).mockResolvedValue(undefined);
    (mdToSp as jest.Mock).mockResolvedValue({ header: undefined });
    (verifySyncState as jest.Mock).mockResolvedValue({ isInSync: true, differences: [] });
    (logSyncVerification as jest.Mock).mockReturnValue(undefined);

    (fileWatcher.startFileWatcher as jest.Mock).mockImplementation((_path, callback) => {
      mockFileChangeCallback = callback;
      return jest.fn(); // Return stop function
    });

    (global as any).PluginAPI = {
      ... (global as any).PluginAPI,
      registerHook: jest.fn((hook, callback) => {
        mockSpHooks.set(hook, callback);
      }),
      onWindowFocusChange: jest.fn((callback) => {
        mockWindowFocusCallback = callback;
      }),
    };
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('MD to SP sync debouncing', () => {
    it('should sync immediately when window is focused', async () => {
      initSyncRegistry(mockBindings);
      await jest.runAllTimersAsync();
      jest.clearAllMocks();

      // Trigger file change (window is focused by default in JSDOM)
      mockFileChangeCallback();
      await jest.runAllTimersAsync();

      expect(mdToSp).toHaveBeenCalledWith('- [ ] Test task', 'test-project');
    });

    it('should debounce MD to SP sync when window is not focused', async () => {
      initSyncRegistry(mockBindings);
      await jest.runAllTimersAsync();
      jest.clearAllMocks();

      mockWindowFocusCallback(false);
      mockFileChangeCallback();

      expect(mdToSp).not.toHaveBeenCalled();

      jest.advanceTimersByTime(SYNC_DEBOUNCE_MS_MD_TO_SP);
      await jest.runAllTimersAsync();

      expect(mdToSp).toHaveBeenCalledTimes(1);
    });
  });

  describe('SP to MD sync behavior', () => {
    it('should use short debounce for SP to MD sync', async () => {
      initSyncRegistry(mockBindings);
      await jest.runAllTimersAsync();
      jest.clearAllMocks();

      const spChangeHandler = mockSpHooks.get(PluginHooks.ANY_TASK_UPDATE);
      if (spChangeHandler) spChangeHandler();

      jest.advanceTimersByTime(SYNC_DEBOUNCE_MS);
      await jest.runAllTimersAsync();

      expect(spToMd).toHaveBeenCalledTimes(1);
      expect(spToMd).toHaveBeenCalledWith(mockBindings[0]);
    });
  });
});
