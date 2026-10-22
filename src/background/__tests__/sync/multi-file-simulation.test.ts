import { initSyncRegistry, setConfigBridge, _resetForTesting } from '../../sync/sync-manager';
import type { SyncBindingCfg } from '../../local-config';
import * as fileWatcher from '../../sync/file-watcher';
import * as fileUtils from '../../helper/file-utils';

jest.mock('../../sync/file-watcher');
jest.mock('../../helper/file-utils');
jest.mock('../../../shared/logger', () => ({
  log: { critical: jest.fn(), err: jest.fn(), error: jest.fn(), log: jest.fn(), normal: jest.fn(), info: jest.fn(), verbose: jest.fn(), debug: jest.fn(), warn: jest.fn() },
}));

// A small in-memory SP and vault, so the real sync code runs end to end.
const MAIN = '/v/Alpha/backlog.md';
const IDEAS = '/v/Alpha/ideas.md';
const NESTED = '/v/Alpha/sub/more.md';

let files: Map<string, string>;
let spTasks: any[];
let counter: number;
let hooks: Record<string, Array<(...a: any[]) => void>>;
let watchers: Map<string, () => void>;

const fireTaskHooks = (task: any): void => {
  (hooks['taskUpdate'] ?? []).forEach((h) => h({ task, changes: {} }));
  (hooks['anyTaskUpdate'] ?? []).forEach((h) => h({ task, changes: {} }));
  (hooks['action'] ?? []).forEach((h) => h({ type: '[Task Shared] addTask' }));
};

const installSp = (): void => {
  (global as any).PluginAPI = {
    registerHook: jest.fn((name: string, cb: (...a: any[]) => void) => {
      (hooks[name] ??= []).push(cb);
    }),
    onWindowFocusChange: jest.fn(),
    showSnack: jest.fn(),
    getTasks: jest.fn(async () => spTasks.map((t) => ({ ...t }))),
    getAllProjects: jest.fn(async () => [
      { id: 'P', title: 'Alpha', taskIds: spTasks.filter((t) => !t.parentId).map((t) => t.id) },
    ]),
    batchUpdateForProject: jest.fn(async ({ operations }: { operations: any[] }) => {
      const created: any[] = [];
      for (const op of operations) {
        if (op.type === 'create') {
          const t = { id: `sp${++counter}`, projectId: 'P', parentId: null, subTaskIds: [], isDone: false, notes: '', ...op.data };
          spTasks.push(t);
          created.push(t);
        } else if (op.type === 'update') {
          Object.assign(spTasks.find((t) => t.id === op.taskId), op.updates);
        } else if (op.type === 'delete') {
          spTasks = spTasks.filter((t) => t.id !== op.taskId);
        }
      }
      created.forEach(fireTaskHooks);
      return { success: true };
    }),
  };
};

const settle = async (): Promise<void> => {
  for (let i = 0; i < 6; i++) await jest.advanceTimersByTimeAsync(5000);
};

const editFile = async (path: string, content: string): Promise<void> => {
  files.set(path, content);
  watchers.get(path)?.();
  await settle();
};

const idsIn = (path: string): string[] => [...(files.get(path) ?? '').matchAll(/<!--([^>]+)-->/g)].map((m) => m[1]);

describe('multi-file project, end to end with an in-memory SP and vault', () => {
  const groupPaths = [MAIN, IDEAS, NESTED];
  const bindings: SyncBindingCfg[] = [
    { id: 'auto-P', filePath: MAIN, projectId: 'P', enabled: true, groupPaths },
    { id: 'auto-P::ideas.md', filePath: IDEAS, projectId: 'P', enabled: true, groupPaths },
    { id: 'auto-P::sub/more.md', filePath: NESTED, projectId: 'P', enabled: true, groupPaths },
  ];

  beforeEach(async () => {
    jest.useFakeTimers();
    _resetForTesting();
    files = new Map([[MAIN, '- [ ] <!--a--> Main task\n'], [IDEAS, ''], [NESTED, '']]);
    spTasks = [{ id: 'a', title: 'Main task', isDone: false, projectId: 'P', parentId: null, subTaskIds: [] }];
    counter = 0;
    hooks = {};
    watchers = new Map();
    installSp();
    (fileUtils.readTasksFile as jest.Mock).mockImplementation(async (p: string) => (files.has(p) ? files.get(p)! : null));
    (fileUtils.writeTasksFile as jest.Mock).mockImplementation(async (p: string, c: string) => {
      files.set(p, c);
    });
    (fileUtils.getFileStats as jest.Mock).mockImplementation(async (p: string) => (files.has(p) ? { mtime: new Date() } : null));
    (fileWatcher.startFileWatcher as jest.Mock).mockImplementation((p: string, cb: () => void) => {
      watchers.set(p, cb);
      return jest.fn();
    });
    setConfigBridge({ reportSynced: jest.fn(), deleteBinding: jest.fn(), repointBinding: jest.fn(), updateBindingTitle: jest.fn() });
    initSyncRegistry(bindings, {});
    await settle();
  });

  afterEach(() => jest.useRealTimers());

  it('a new line in an extra file becomes one SP task, stamped in that file only', async () => {
    await editFile(IDEAS, '- [ ] new task\n- [ ] another task');
    expect(spTasks.map((t) => t.title).sort()).toEqual(['Main task', 'another task', 'new task']);
    expect(idsIn(IDEAS)).toHaveLength(2);
    expect(idsIn(MAIN)).toEqual(['a']);
  });

  it('stays stable across further edits and SP changes', async () => {
    await editFile(IDEAS, '- [ ] new task');
    await editFile(IDEAS, files.get(IDEAS)! + '\n- [ ] second');
    await editFile(MAIN, files.get(MAIN)! + '- [ ] typed in main\n');
    spTasks.find((t) => t.title === 'new task').isDone = true;
    fireTaskHooks(spTasks[1]);
    await settle();
    expect(spTasks).toHaveLength(4);
    expect(idsIn(IDEAS)).toHaveLength(2);
    expect(idsIn(MAIN)).toHaveLength(2);
    expect(files.get(IDEAS)).toContain('[x]');
  });

  it('a new line in a nested file is handled the same way', async () => {
    await editFile(NESTED, '- [ ] deep task');
    expect(spTasks.filter((t) => t.title === 'deep task')).toHaveLength(1);
    expect(idsIn(NESTED)).toHaveLength(1);
    expect(idsIn(MAIN)).toEqual(['a']);
  });

  it('a task created in SP goes to the main file only', async () => {
    spTasks.push({ id: 'z', title: 'from SP', isDone: false, projectId: 'P', parentId: null, subTaskIds: [] });
    fireTaskHooks(spTasks[1]);
    await settle();
    expect(idsIn(MAIN)).toContain('z');
    expect(idsIn(IDEAS)).toEqual([]);
  });

  it('a line copied to a second file does not create more tasks', async () => {
    await editFile(IDEAS, '- [ ] <!--a--> Main task\n');
    await editFile(MAIN, files.get(MAIN)! + '- [ ] typed\n');
    expect(spTasks.filter((t) => t.title === 'Main task')).toHaveLength(1);
    expect(spTasks).toHaveLength(2);
  });

  const withoutIdeas = (): SyncBindingCfg[] => {
    const paths = [MAIN, NESTED];
    return [bindings[0], bindings[2]].map((b) => ({ ...b, groupPaths: paths, filesRemoved: true }));
  };

  it('deleting an extra file deletes its tasks in SP (task file has tasks)', async () => {
    await editFile(IDEAS, '- [ ] idea one\n- [ ] idea two');
    expect(spTasks).toHaveLength(3);
    files.delete(IDEAS);
    initSyncRegistry(withoutIdeas(), { 'auto-P': 'x', 'auto-P::ideas.md': 'x', 'auto-P::sub/more.md': 'x' });
    await settle();
    expect(spTasks.map((t) => t.title)).toEqual(['Main task']);
    expect(files.has(IDEAS)).toBe(false);
  });

  it('deleting an extra file deletes its tasks in SP (task file is empty)', async () => {
    files.set(MAIN, '');
    spTasks = [];
    await editFile(IDEAS, '- [ ] idea one');
    expect(spTasks).toHaveLength(1);
    files.delete(IDEAS);
    initSyncRegistry(withoutIdeas(), { 'auto-P': 'x', 'auto-P::ideas.md': 'x', 'auto-P::sub/more.md': 'x' });
    await settle();
    expect(spTasks).toHaveLength(0);
    expect(files.get(MAIN)).not.toContain('idea one');
  });

  it('deleting a task line in the task file deletes the task in SP', async () => {
    await editFile(IDEAS, '- [ ] idea one');
    await editFile(MAIN, files.get(MAIN)! + '- [ ] second main\n');
    expect(spTasks).toHaveLength(3);
    files.set(MAIN, files.get(MAIN)!.split('\n').filter((l) => !l.includes('Main task')).join('\n'));
    watchers.get(MAIN)?.();
    await settle();
    expect(spTasks.map((t) => t.title).sort()).toEqual(['idea one', 'second main']);
    expect(files.get(MAIN)).not.toContain('Main task');
  });

  it('deleting a task line in an extra file deletes the task in SP', async () => {
    await editFile(IDEAS, '- [ ] idea one\n- [ ] idea two');
    files.set(IDEAS, files.get(IDEAS)!.split('\n').filter((l) => !l.includes('idea one')).join('\n'));
    watchers.get(IDEAS)?.();
    await settle();
    expect(spTasks.map((t) => t.title).sort()).toEqual(['Main task', 'idea two']);
    expect(files.get(MAIN)).not.toContain('idea one');
  });

  it('deleting the last task line of the task file deletes the task in SP', async () => {
    await editFile(IDEAS, '- [ ] idea one');
    files.set(MAIN, '');
    watchers.get(MAIN)?.();
    await settle();
    expect(spTasks.map((t) => t.title)).toEqual(['idea one']);
    expect(files.get(MAIN)).toBe('');
  });

  it('clearing the only task file of the project deletes its tasks too', async () => {
    files.set(MAIN, '');
    watchers.get(MAIN)?.();
    await settle();
    expect(spTasks).toHaveLength(0);
  });
});
