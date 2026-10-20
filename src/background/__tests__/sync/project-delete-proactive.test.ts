import {
  initSyncRegistry,
  setConfigBridge,
  _resetForTesting,
  isProjectDeleteAction,
  isStructuralTaskAction,
} from '../../sync/sync-manager';
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

/**
 * Bug #48: the "SP project deleted" dialog must appear PROACTIVELY when a project
 * is deleted — not only after a manual Sync Now.
 *
 * ROOT CAUSE (console-verified 2026-09-16, after two wrong hypotheses): deleting a
 * project notifies the plugin through EXACTLY ONE channel — the generic `action`
 * hook with `[Task Shared] deleteProject`, which the `isStructuralTaskAction`
 * filter rejected. A full capture of a real delete showed `projectListUpdate` never
 * firing (registered, but not dispatched — not even on project CREATE) and no
 * `taskUpdate`/`anyTaskUpdate` at all, so `handleSpChange` was never scheduled
 * either. Nothing reached `divertIfProjectMissing`; the dialog (and the proactive
 * snack) simply had no trigger until the user's next manual sync.
 *
 * The fix routes `isProjectDeleteAction` types from the `action` hook into
 * `handleProjectListUpdate`, which runs the existence check directly — off
 * `handleSpChange`'s SP_HOOK_COOLDOWN_MS gate, which the delete churn can trip —
 * plus one re-check for a lagged project store. `projectListUpdate` stays wired as
 * a fallback for SP versions that do dispatch it; the per-binding dialog guard
 * makes the double trigger harmless.
 *
 * These tests assert the observable contract from BOTH entry points: a deletion
 * surfaces snack + dialog with no manual sync; a rename/reorder does neither; a
 * late-reported deletion is still caught on the re-check; and the modal is never
 * opened synchronously inside the delete's own tick.
 */
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

/** Return the callback the registry installed for a given SP hook name. */
const getHook = (name: string): ((...args: unknown[]) => unknown) => {
  const call = (PluginAPI.registerHook as jest.Mock).mock.calls.find((c) => c[0] === name);
  if (!call) throw new Error(`hook not registered: ${name}`);
  return call[1];
};

describe('Sync Manager — proactive deleted-project detection (Bug #48)', () => {
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
    _resetForTesting();

    // Default: project p1 PRESENT so the initial sync is clean; file has tasks.
    (PluginAPI.getAllProjects as jest.Mock).mockResolvedValue([{ id: 'p1' }]);
    (fileUtils.getFileStats as jest.Mock).mockResolvedValue({ mtime: new Date() });
    (fileUtils.readTasksFile as jest.Mock).mockResolvedValue('- [ ] <!--id--> Task');
    (spToMd as jest.Mock).mockResolvedValue(undefined);
    (mdToSp as jest.Mock).mockResolvedValue(undefined);
    (verifySyncState as jest.Mock).mockResolvedValue({ isInSync: true, differences: [] });
    (logSyncVerification as jest.Mock).mockReturnValue(undefined);
    (fileWatcher.startFileWatcher as jest.Mock).mockReturnValue(jest.fn());
    (createSpProject as jest.Mock).mockResolvedValue('p2');
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

  it('opens the dialog from projectListUpdate alone when the project is deleted', async () => {
    initSyncRegistry([config], {});
    await jest.runAllTimersAsync();
    (showMissingProjectDialog as jest.Mock).mockClear();

    // p1 deleted.
    (PluginAPI.getAllProjects as jest.Mock).mockResolvedValue([{ id: 'other' }]);
    getHook('projectListUpdate')();
    await jest.runAllTimersAsync();

    // Proactive — no syncAllNow was needed.
    expect(showMissingProjectDialog).toHaveBeenCalledWith(
      '/test/tasks.md',
      expect.objectContaining({
        onRecreate: expect.any(Function),
        onDelete: expect.any(Function),
      }),
      true,
      undefined,
    );
  });

  it('does NOT open the dialog when the project still exists (rename/reorder)', async () => {
    initSyncRegistry([config], {});
    await jest.runAllTimersAsync();
    (showMissingProjectDialog as jest.Mock).mockClear();

    // Project still present — a rename/reorder/create.
    getHook('projectListUpdate')();
    await jest.runAllTimersAsync();

    expect(showMissingProjectDialog).not.toHaveBeenCalled();
  });

  it('catches a deletion the project store reported late, on the re-check', async () => {
    const getAll = PluginAPI.getAllProjects as jest.Mock;
    initSyncRegistry([config], {});
    await jest.runAllTimersAsync();
    (showMissingProjectDialog as jest.Mock).mockClear();

    // First check after the hook still lists p1 (store lag); every check after that
    // sees it gone — the re-check must catch it.
    getAll.mockResolvedValueOnce([{ id: 'p1' }]).mockResolvedValue([{ id: 'other' }]);
    getHook('projectListUpdate')();
    await jest.runAllTimersAsync();

    expect(showMissingProjectDialog).toHaveBeenCalledWith(
      '/test/tasks.md',
      expect.anything(),
      true,
      undefined,
    );
  });

  it('defers the dialog past the delete-navigation churn (never opens synchronously)', async () => {
    initSyncRegistry([config], {});
    await jest.runAllTimersAsync();
    (showMissingProjectDialog as jest.Mock).mockClear();

    // p1 deleted. Opening openDialog in the same tick as SP's project-delete
    // navigation (its own confirm dialog closing + routing away from the active
    // project) leaves the modal unpainted — so the handler must NOT open it before
    // the churn settles. Draining microtasks (without advancing timers) must not
    // have opened it; only after the deferred macrotask fires does it show.
    (PluginAPI.getAllProjects as jest.Mock).mockResolvedValue([{ id: 'other' }]);
    getHook('projectListUpdate')();
    await Promise.resolve();
    expect(showMissingProjectDialog).not.toHaveBeenCalled();

    await jest.runAllTimersAsync();
    expect(showMissingProjectDialog).toHaveBeenCalled();
  });

  it('fires a reliable snack heads-up when the project is deleted (proactive path)', async () => {
    initSyncRegistry([config], {});
    await jest.runAllTimersAsync();
    (PluginAPI.showSnack as jest.Mock).mockClear();

    // p1 deleted. The modal can be swallowed by the delete-navigation churn, so the
    // proactive path must ALSO surface a snack (which paints reliably from the
    // background) naming the affected PROJECT (projectTitle, or the file's basename
    // when the project was never seen — here 'tasks' from /test/tasks.md).
    (PluginAPI.getAllProjects as jest.Mock).mockResolvedValue([{ id: 'other' }]);
    getHook('projectListUpdate')();
    await jest.runAllTimersAsync();

    expect(PluginAPI.showSnack).toHaveBeenCalledWith(
      expect.objectContaining({ msg: expect.stringContaining('project "tasks" was deleted') }),
    );
  });

  it('does NOT fire the deleted-project snack on a rename/reorder (project present)', async () => {
    initSyncRegistry([config], {});
    await jest.runAllTimersAsync();
    (PluginAPI.showSnack as jest.Mock).mockClear();

    getHook('projectListUpdate')();
    await jest.runAllTimersAsync();

    expect(PluginAPI.showSnack).not.toHaveBeenCalled();
  });

  it('opens the dialog + snack via the task-deletion path (taskUpdate → handleSpChange)', async () => {
    // The real trigger seen in the SP logs: deleting a project also deletes its
    // tasks, whose taskUpdate reaches handleSpChange — often the path that actually
    // detects the missing project (mid-churn, no user interaction). It must be
    // PROACTIVE too: a reliable snack + the settle-deferred modal, not a bare modal
    // opened during the navigation churn (which SP never repaints).
    initSyncRegistry([config], {});
    await jest.runAllTimersAsync();
    (showMissingProjectDialog as jest.Mock).mockClear();
    (PluginAPI.showSnack as jest.Mock).mockClear();

    // p1 deleted; a taskUpdate with no projectId fans out to all sessions.
    (PluginAPI.getAllProjects as jest.Mock).mockResolvedValue([{ id: 'other' }]);
    getHook('taskUpdate')({});
    await jest.runAllTimersAsync();

    expect(PluginAPI.showSnack).toHaveBeenCalledWith(
      expect.objectContaining({ msg: expect.stringContaining('project "tasks" was deleted') }),
    );
    expect(showMissingProjectDialog).toHaveBeenCalled();
  });

  // ── The ACTUAL trigger SP gives us (console-verified) ─────────────────────
  // `[Task Shared] deleteProject` on the generic `action` hook is the ONLY event
  // a project deletion produces: no projectListUpdate, no taskUpdate. Without
  // this route the whole proactive path is unreachable, which is exactly what
  // Bug #48 looked like from the outside.

  it('opens snack + dialog from the `action` hook alone ([Task Shared] deleteProject)', async () => {
    initSyncRegistry([config], {});
    await jest.runAllTimersAsync();
    (showMissingProjectDialog as jest.Mock).mockClear();
    (PluginAPI.showSnack as jest.Mock).mockClear();

    (PluginAPI.getAllProjects as jest.Mock).mockResolvedValue([{ id: 'other' }]);
    getHook('action')({ type: '[Task Shared] deleteProject' });
    await jest.runAllTimersAsync();

    expect(PluginAPI.showSnack).toHaveBeenCalledWith(
      expect.objectContaining({ msg: expect.stringContaining('project "tasks" was deleted') }),
    );
    expect(showMissingProjectDialog).toHaveBeenCalledWith(
      '/test/tasks.md',
      expect.anything(),
      true,
      undefined,
    );
  });

  it('does not open the dialog from `deleteProject` when this binding survives', async () => {
    initSyncRegistry([config], {});
    await jest.runAllTimersAsync();
    (showMissingProjectDialog as jest.Mock).mockClear();
    (PluginAPI.showSnack as jest.Mock).mockClear();

    // Some OTHER project was deleted — p1 is still listed.
    getHook('action')({ type: '[Task Shared] deleteProject' });
    await jest.runAllTimersAsync();

    expect(showMissingProjectDialog).not.toHaveBeenCalled();
    expect(PluginAPI.showSnack).not.toHaveBeenCalled();
  });

  it('a project delete does not write SP→MD for the deleted binding', async () => {
    initSyncRegistry([config], {});
    await jest.runAllTimersAsync();
    (spToMd as jest.Mock).mockClear();

    // The delete must divert to the dialog, never fall through to a write-back —
    // spToMd with a missing project would write an empty file over the `.md`.
    (PluginAPI.getAllProjects as jest.Mock).mockResolvedValue([{ id: 'other' }]);
    getHook('action')({ type: '[Task Shared] deleteProject' });
    await jest.runAllTimersAsync();

    expect(spToMd).not.toHaveBeenCalled();
  });
});

describe('isProjectDeleteAction', () => {
  it('matches SP\'s project-delete action across scope-prefix spellings', () => {
    expect(isProjectDeleteAction('[Task Shared] deleteProject')).toBe(true);
    expect(isProjectDeleteAction('[a][Task Shared] deleteProject')).toBe(true);
    expect(isProjectDeleteAction('[Project] Delete Project')).toBe(true);
  });

  it('does not match task deletes, project creates or other project actions', () => {
    expect(isProjectDeleteAction('[Task Shared] deleteTask')).toBe(false);
    expect(isProjectDeleteAction('[Project] Add Project')).toBe(false);
    expect(isProjectDeleteAction('[Project] Update Project')).toBe(false);
    expect(isProjectDeleteAction('[Project] Archive Project')).toBe(false);
  });

  it('is disjoint from the structural TASK action set (different handling)', () => {
    expect(isStructuralTaskAction('[Task Shared] deleteProject')).toBe(false);
  });
});
