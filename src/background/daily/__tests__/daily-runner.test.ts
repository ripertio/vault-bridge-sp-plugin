import { runDailyNoteDryRun } from '../daily-runner';
import { DEFAULT_DAILY_NOTE_CFG } from '../daily-note';
import { readTasksFile, writeTasksFile } from '../../helper/file-utils';

jest.mock('../../helper/file-utils');
jest.mock('../../../shared/logger', () => ({
  log: { log: jest.fn(), error: jest.fn() },
}));

const mockedRead = readTasksFile as jest.MockedFunction<typeof readTasksFile>;
const mockedWrite = writeTasksFile as jest.MockedFunction<typeof writeTasksFile>;
const { log } = jest.requireMock('../../../shared/logger') as { log: { log: jest.Mock; error: jest.Mock } };

const NOW = new Date(2026, 9, 21);
const deps = { getBaseline: () => ({}), saveBaseline: jest.fn(), getBaselineDay: () => '2026-10-21' };
const ROOT = '/vault';
const cfg = { ...DEFAULT_DAILY_NOTE_CFG, enabled: true, vaultPath: ROOT };

const setSp = (taskIds: string[]) => {
  (global as any).PluginAPI = {
    getAllTags: jest.fn().mockResolvedValue([{ id: 'TODAY', taskIds }]),
    getTasks: jest.fn().mockResolvedValue([
      { id: 'p1', title: 'Project task', isDone: false, projectId: 'S3' },
      { id: 'i1', title: 'Inbox task', isDone: false, projectId: 'INBOX_PROJECT' },
      { id: 'other', title: 'Not today', isDone: false, projectId: 'S3' },
    ]),
  };
};

beforeEach(() => {
  jest.clearAllMocks();
  mockedRead.mockResolvedValue('## To Dos\n');
});

describe('runDailyNoteDryRun', () => {
  it('does nothing when the feature is disabled', async () => {
    setSp(['p1']);
    await runDailyNoteDryRun({ ...cfg, enabled: false }, deps, NOW);
    expect(mockedRead).not.toHaveBeenCalled();
    expect(log.log).not.toHaveBeenCalled();
  });

  it('refuses to run without a vault root', async () => {
    setSp(['p1']);
    await runDailyNoteDryRun({ ...cfg, vaultPath: '' }, deps, NOW);
    expect(log.error).toHaveBeenCalled();
    expect(mockedRead).not.toHaveBeenCalled();
  });

  it('reads the day note under the vault root and logs the planned tasks', async () => {
    setSp(['p1', 'i1']);
    await runDailyNoteDryRun(cfg, deps, NOW);
    expect(mockedRead).toHaveBeenCalledWith('/vault/Daily/2026-10-21.md');
    expect(log.log).toHaveBeenCalledWith('would add 2 task(s) to ## To Dos');
  });

  it('only plans tasks that are in the TODAY tag', async () => {
    setSp(['p1']);
    await runDailyNoteDryRun(cfg, deps, NOW);
    expect(log.log).toHaveBeenCalledWith('would add 1 task(s) to ## To Dos');
  });

  it('does not write in dry-run mode even when tasks are missing', async () => {
    setSp(['p1']);
    await runDailyNoteDryRun({ ...cfg, dryRun: true }, deps, NOW);
    expect(mockedWrite).not.toHaveBeenCalled();
  });

  it('appends missing tasks when dryRun is false', async () => {
    setSp(['p1']);
    await runDailyNoteDryRun({ ...cfg, dryRun: false }, deps, NOW);
    expect(mockedWrite).toHaveBeenCalledTimes(1);
    expect(mockedWrite).toHaveBeenCalledWith(
      '/vault/Daily/2026-10-21.md',
      '## To Dos\n- [ ] <!--p1--> Project task\n',
    );
  });

  it('writes an empty existing note without a leading blank line', async () => {
    mockedRead.mockResolvedValue('');
    setSp(['p1']);
    await runDailyNoteDryRun({ ...cfg, dryRun: false }, deps, NOW);
    expect(mockedWrite).toHaveBeenCalledWith(
      '/vault/Daily/2026-10-21.md',
      '## To Dos\n- [ ] <!--p1--> Project task',
    );
  });

  it('writes when only a checkbox needs updating', async () => {
    mockedRead.mockResolvedValue('## To Dos\n- [ ] <!--p1--> Project task');
    (global as any).PluginAPI = {
      getAllTags: jest.fn().mockResolvedValue([{ id: 'TODAY', taskIds: ['p1'] }]),
      getTasks: jest.fn().mockResolvedValue([
        { id: 'p1', title: 'Project task', isDone: true, projectId: 'S3' },
      ]),
    };
    await runDailyNoteDryRun({ ...cfg, dryRun: false }, deps, NOW);
    expect(mockedWrite).toHaveBeenCalledWith(
      '/vault/Daily/2026-10-21.md',
      '## To Dos\n- [x] <!--p1--> Project task',
    );
  });

  it('does not write when nothing is missing and checkboxes match', async () => {
    mockedRead.mockResolvedValue('## To Dos\n- [ ] <!--p1--> Project task');
    setSp(['p1']);
    await runDailyNoteDryRun({ ...cfg, dryRun: false }, deps, NOW);
    expect(mockedWrite).not.toHaveBeenCalled();
  });

  it('skips the write when the note changed during planning', async () => {
    mockedRead
      .mockResolvedValueOnce('## To Dos\n')
      .mockResolvedValueOnce('## To Dos\nuser edit\n');
    setSp(['p1']);
    await runDailyNoteDryRun({ ...cfg, dryRun: false }, deps, NOW);
    expect(mockedWrite).not.toHaveBeenCalled();
    expect(log.log).toHaveBeenCalledWith('daily note changed during planning, skipping write');
  });

  it('never creates a missing note', async () => {
    mockedRead.mockResolvedValue(null);
    setSp(['p1']);
    await runDailyNoteDryRun({ ...cfg, dryRun: false }, deps, NOW);
    expect(mockedWrite).not.toHaveBeenCalled();
  });

  it('pushes a note checkbox edit to SP via updateTask when writes are on', async () => {
    mockedRead.mockResolvedValue('## To Dos\n- [x] <!--p1--> Project task');
    const updateTask = jest.fn().mockResolvedValue(undefined);
    (global as any).PluginAPI = {
      getAllTags: jest.fn().mockResolvedValue([{ id: 'TODAY', taskIds: ['p1'] }]),
      getTasks: jest.fn().mockResolvedValue([
        { id: 'p1', title: 'Project task', isDone: false, projectId: 'S3' },
      ]),
      updateTask,
    };
    const withBaseline = {
      getBaseline: () => ({ p1: { isDone: false, title: 'Project task' } }),
      getBaselineDay: () => '2026-10-21',
      saveBaseline: jest.fn(),
    };
    await runDailyNoteDryRun({ ...cfg, dryRun: false }, withBaseline, NOW);
    expect(updateTask).toHaveBeenCalledWith('p1', { isDone: true });
  });

  it('does not push note edits to SP in dry-run', async () => {
    mockedRead.mockResolvedValue('## To Dos\n- [x] <!--p1--> Project task');
    const updateTask = jest.fn();
    (global as any).PluginAPI = {
      getAllTags: jest.fn().mockResolvedValue([{ id: 'TODAY', taskIds: ['p1'] }]),
      getTasks: jest.fn().mockResolvedValue([
        { id: 'p1', title: 'Project task', isDone: false, projectId: 'S3' },
      ]),
      updateTask,
    };
    const withBaseline = {
      getBaseline: () => ({ p1: { isDone: false, title: 'Project task' } }),
      getBaselineDay: () => '2026-10-21',
      saveBaseline: jest.fn(),
    };
    await runDailyNoteDryRun({ ...cfg, dryRun: true }, withBaseline, NOW);
    expect(updateTask).not.toHaveBeenCalled();
  });

  it('saves the baseline only after a successful write', async () => {
    mockedRead.mockResolvedValue('## To Dos\n');
    setSp(['p1']);
    const saveBaseline = jest.fn();
    await runDailyNoteDryRun({ ...cfg, dryRun: false }, { getBaseline: () => ({}), saveBaseline }, NOW);
    expect(mockedWrite).toHaveBeenCalled();
    expect(saveBaseline).toHaveBeenCalledWith({ p1: { isDone: false, title: 'Project task' } }, '2026-10-21');
  });

  it('does not save a baseline in dry-run', async () => {
    mockedRead.mockResolvedValue('## To Dos\n');
    setSp(['p1']);
    const saveBaseline = jest.fn();
    await runDailyNoteDryRun({ ...cfg, dryRun: true }, { getBaseline: () => ({}), saveBaseline }, NOW);
    expect(saveBaseline).not.toHaveBeenCalled();
  });

  it('creates an SP task for a typed note line and stamps its ID (write mode)', async () => {
    mockedRead.mockResolvedValue('## To Dos\n- [ ] Neuer Task');
    const addTask = jest.fn().mockResolvedValue('NEW1');
    (global as any).PluginAPI = {
      getAllTags: jest.fn().mockResolvedValue([{ id: 'TODAY', taskIds: [] }]),
      getTasks: jest.fn().mockResolvedValue([]),
      addTask,
    };
    await runDailyNoteDryRun({ ...cfg, dryRun: false }, deps, NOW);
    expect(addTask).toHaveBeenCalledWith({ title: 'Neuer Task', isDone: false, dueDay: '2026-10-21' });
    expect(mockedWrite).toHaveBeenCalledWith('/vault/Daily/2026-10-21.md', '## To Dos\n- [ ] <!--NEW1--> Neuer Task');
  });

  it('does not create SP tasks in dry-run', async () => {
    mockedRead.mockResolvedValue('## To Dos\n- [ ] Neuer Task');
    const addTask = jest.fn();
    (global as any).PluginAPI = {
      getAllTags: jest.fn().mockResolvedValue([{ id: 'TODAY', taskIds: [] }]),
      getTasks: jest.fn().mockResolvedValue([]),
      addTask,
    };
    await runDailyNoteDryRun({ ...cfg, dryRun: true }, deps, NOW);
    expect(addTask).not.toHaveBeenCalled();
    expect(mockedWrite).not.toHaveBeenCalled();
  });

  it('does not delete in SP by default (deleteRemoved off), even when a line was removed', async () => {
    mockedRead.mockResolvedValue('## To Dos\n');
    setSp([]);
    const batch = jest.fn().mockResolvedValue({ success: true });
    (global as any).PluginAPI = { ...(global as any).PluginAPI, batchUpdateForProject: batch };
    const withBaseline = {
      getBaseline: () => ({ p1: { isDone: false, title: 'Project task' } }),
      getBaselineDay: () => '2026-10-21',
      saveBaseline: jest.fn(),
    };
    await runDailyNoteDryRun({ ...cfg, dryRun: false }, withBaseline, NOW);
    expect(batch).not.toHaveBeenCalled();
  });

  it('deletes via the shared batch op when deleteRemoved is on and writes are on', async () => {
    mockedRead.mockResolvedValue('## To Dos\n');
    setSp([]);
    const batch = jest.fn().mockResolvedValue({ success: true });
    (global as any).PluginAPI = { ...(global as any).PluginAPI, batchUpdateForProject: batch };
    const withBaseline = {
      getBaseline: () => ({ p1: { isDone: false, title: 'Project task' } }),
      getBaselineDay: () => '2026-10-21',
      saveBaseline: jest.fn(),
    };
    await runDailyNoteDryRun({ ...cfg, dryRun: false, deleteRemoved: true }, withBaseline, NOW);
    expect(batch).toHaveBeenCalledWith({
      projectId: 'S3',
      operations: [{ type: 'delete', taskId: 'p1' }],
    });
  });

  it('does not delete in dry-run even when deleteRemoved is on', async () => {
    mockedRead.mockResolvedValue('## To Dos\n');
    setSp([]);
    const batch = jest.fn();
    (global as any).PluginAPI = { ...(global as any).PluginAPI, batchUpdateForProject: batch };
    const withBaseline = {
      getBaseline: () => ({ p1: { isDone: false, title: 'Project task' } }),
      getBaselineDay: () => '2026-10-21',
      saveBaseline: jest.fn(),
    };
    await runDailyNoteDryRun({ ...cfg, dryRun: true, deleteRemoved: true }, withBaseline, NOW);
    expect(batch).not.toHaveBeenCalled();
  });

  it('records a task created from the note in the baseline, so its removal can be detected', async () => {
    mockedRead.mockResolvedValue('## To Dos\n- [ ] Neuer Task');
    const saveBaseline = jest.fn();
    (global as any).PluginAPI = {
      getAllTags: jest.fn().mockResolvedValue([{ id: 'TODAY', taskIds: [] }]),
      getTasks: jest.fn().mockResolvedValue([]),
      addTask: jest.fn().mockResolvedValue('NEW3'),
    };
    await runDailyNoteDryRun({ ...cfg, dryRun: false }, { getBaseline: () => ({}), saveBaseline }, NOW);
    expect(saveBaseline.mock.calls.at(-1)?.[0]).toHaveProperty('NEW3');
  });

  it('never mutates SP tasks', async () => {
    setSp(['p1', 'i1']);
    await runDailyNoteDryRun(cfg, deps, NOW);
    const api = (global as any).PluginAPI;
    expect(api.getTasks).toHaveBeenCalled();
    expect(api.updateTask).toBeUndefined();
    expect(api.addTask).toBeUndefined();
  });

  it('rejects a folder that escapes the vault before any read', async () => {
    setSp(['p1']);
    await expect(
      runDailyNoteDryRun({ ...cfg, folder: '../outside' }, deps, NOW),
    ).rejects.toThrow();
    expect(mockedRead).not.toHaveBeenCalled();
  });
});

describe('runDailyNoteDryRun baseline day', () => {
  it('never deletes tasks from yesterday that are missing from the new day note', async () => {
    mockedRead.mockResolvedValue('## To Dos\n');
    setSp([]);
    const batch = jest.fn().mockResolvedValue({ success: true });
    (global as any).PluginAPI = { ...(global as any).PluginAPI, batchUpdateForProject: batch };
    const yesterday = {
      getBaseline: () => ({ p1: { isDone: false, title: 'Project task' } }),
      getBaselineDay: () => '2026-10-20',
      saveBaseline: jest.fn(),
    };
    await runDailyNoteDryRun({ ...cfg, dryRun: false, deleteRemoved: true }, yesterday, NOW);
    expect(batch).not.toHaveBeenCalled();
  });

  it('does not push a checkbox edit against yesterday baseline to SP', async () => {
    mockedRead.mockResolvedValue('## To Dos\n- [x] <!--p1--> Project task\n');
    const updateTask = jest.fn().mockResolvedValue(undefined);
    (global as any).PluginAPI = {
      getAllTags: jest.fn().mockResolvedValue([{ id: 'TODAY', taskIds: [] }]),
      getTasks: jest.fn().mockResolvedValue([{ id: 'p1', title: 'Project task', isDone: false, projectId: 'S3' }]),
      updateTask,
    };
    const yesterday = {
      getBaseline: () => ({ p1: { isDone: false, title: 'Project task' } }),
      getBaselineDay: () => '2026-10-20',
      saveBaseline: jest.fn(),
    };
    await runDailyNoteDryRun({ ...cfg, dryRun: false }, yesterday, NOW);
    expect(updateTask).not.toHaveBeenCalled();
  });

  it('forgets yesterday baseline entries once it writes the new day note', async () => {
    mockedRead.mockResolvedValue('## To Dos\n');
    setSp(['i1']);
    const yesterday = {
      getBaseline: () => ({ p1: { isDone: false, title: 'Project task' } }),
      getBaselineDay: () => '2026-10-20',
      saveBaseline: jest.fn(),
    };
    await runDailyNoteDryRun({ ...cfg, dryRun: false }, yesterday, NOW);
    const saved = yesterday.saveBaseline.mock.calls[0][0];
    expect(saved).not.toHaveProperty('p1');
    expect(yesterday.saveBaseline.mock.calls[0][1]).toBe('2026-10-21');
  });
});

describe('runDailyNoteDryRun rollover', () => {
  const YESTERDAY_NOTE = '## To Dos\n- [ ] <!--p1--> Project task\n- [x] <!--i1--> Inbox task\n';
  const mockNotes = (notes: Record<string, string>) =>
    mockedRead.mockImplementation(async (path: string) => {
      const name = path.split('/').pop() ?? '';
      return name in notes ? notes[name] : null;
    });
  const rollCfg = { ...cfg, rolloverOverdue: true, dryRun: false };
  const rollDeps = (extra: object = {}) => ({
    getBaseline: () => ({}),
    saveBaseline: jest.fn(),
    getBaselineDay: () => '2026-10-21',
    getRolloverDay: () => undefined,
    saveRolloverDay: jest.fn(),
    ...extra,
  });

  it('does nothing when rolloverOverdue is off (the default)', async () => {
    mockNotes({ '2026-10-21.md': '## To Dos\n', '2026-10-20.md': YESTERDAY_NOTE });
    setSp([]);
    await runDailyNoteDryRun({ ...cfg, dryRun: false }, rollDeps(), NOW);
    expect(mockedWrite).not.toHaveBeenCalled();
  });

  it('carries unfinished tasks from yesterday into today and records the day', async () => {
    mockNotes({ '2026-10-21.md': '## To Dos\n', '2026-10-20.md': YESTERDAY_NOTE });
    setSp([]);
    const deps = rollDeps();
    await runDailyNoteDryRun(rollCfg, deps, NOW);
    expect(mockedWrite).toHaveBeenCalledWith(
      '/vault/Daily/2026-10-21.md',
      '## To Dos\n- [ ] <!--p1--> Project task\n',
    );
    expect(deps.saveRolloverDay).toHaveBeenCalledWith('2026-10-21');
  });

  it('logs but does not write or record the day in dry-run', async () => {
    mockNotes({ '2026-10-21.md': '## To Dos\n', '2026-10-20.md': YESTERDAY_NOTE });
    setSp([]);
    const deps = rollDeps();
    await runDailyNoteDryRun({ ...rollCfg, dryRun: true }, deps, NOW);
    expect(log.log).toHaveBeenCalledWith('  ↻ rollover "Project task" from 2026-10-20 (dry-run)');
    expect(mockedWrite).not.toHaveBeenCalled();
    expect(deps.saveRolloverDay).not.toHaveBeenCalled();
  });

  it('runs at most once per day', async () => {
    mockNotes({ '2026-10-21.md': '## To Dos\n', '2026-10-20.md': YESTERDAY_NOTE });
    setSp([]);
    await runDailyNoteDryRun(rollCfg, rollDeps({ getRolloverDay: () => '2026-10-21' }), NOW);
    expect(mockedWrite).not.toHaveBeenCalled();
  });

  it('skips tasks that are done in SP', async () => {
    mockNotes({ '2026-10-21.md': '## To Dos\n', '2026-10-20.md': YESTERDAY_NOTE });
    (global as any).PluginAPI = {
      getAllTags: jest.fn().mockResolvedValue([{ id: 'TODAY', taskIds: [] }]),
      getTasks: jest.fn().mockResolvedValue([{ id: 'p1', title: 'Project task', isDone: true, projectId: 'S3' }]),
    };
    await runDailyNoteDryRun(rollCfg, rollDeps(), NOW);
    expect(mockedWrite).not.toHaveBeenCalled();
  });

  it('does not re-add a task that is already in today note', async () => {
    mockNotes({
      '2026-10-21.md': '## To Dos\n- [ ] <!--p1--> Project task\n',
      '2026-10-20.md': YESTERDAY_NOTE,
    });
    setSp([]);
    await runDailyNoteDryRun(rollCfg, rollDeps(), NOW);
    expect(mockedWrite).not.toHaveBeenCalled();
  });

  it('looks back past a missing day to the last note that exists', async () => {
    mockNotes({ '2026-10-21.md': '## To Dos\n', '2026-10-19.md': YESTERDAY_NOTE });
    setSp([]);
    await runDailyNoteDryRun(rollCfg, rollDeps(), NOW);
    expect(log.log).toHaveBeenCalledWith('  ↻ rollover "Project task" from 2026-10-19');
    expect(mockedWrite).toHaveBeenCalled();
  });
});

describe('runDailyNoteDryRun mirrors SP deletes and checkboxes into the note', () => {
  const setTasks = (tasks: { id: string; title: string; isDone: boolean; projectId: string }[], today: string[]) => {
    (global as any).PluginAPI = {
      getAllTags: jest.fn().mockResolvedValue([{ id: 'TODAY', taskIds: today }]),
      getTasks: jest.fn().mockResolvedValue(tasks),
    };
  };

  it('removes a note line whose SP task is gone when deleteRemoved is on (write mode)', async () => {
    mockedRead.mockResolvedValue('## To Dos\n- [ ] <!--gone--> Old\n');
    setTasks([{ id: 'p1', title: 'Project task', isDone: false, projectId: 'S3' }], ['p1']);
    await runDailyNoteDryRun({ ...cfg, dryRun: false, deleteRemoved: true }, deps, NOW);
    expect(mockedWrite).toHaveBeenCalledWith(
      '/vault/Daily/2026-10-21.md',
      '## To Dos\n- [ ] <!--p1--> Project task\n',
    );
  });

  it('keeps the note line when deleteRemoved is off', async () => {
    mockedRead.mockResolvedValue('## To Dos\n- [ ] <!--gone--> Old\n');
    setTasks([{ id: 'p1', title: 'Project task', isDone: false, projectId: 'S3' }], ['p1']);
    await runDailyNoteDryRun({ ...cfg, dryRun: false, deleteRemoved: false }, deps, NOW);
    expect(mockedWrite).toHaveBeenCalledWith(
      '/vault/Daily/2026-10-21.md',
      '## To Dos\n- [ ] <!--gone--> Old\n- [ ] <!--p1--> Project task\n',
    );
  });

  it('only logs the gone line in dry-run, even when deleteRemoved is on', async () => {
    mockedRead.mockResolvedValue('## To Dos\n- [ ] <!--gone--> Old\n');
    setTasks([{ id: 'p1', title: 'Project task', isDone: false, projectId: 'S3' }], ['p1']);
    await runDailyNoteDryRun({ ...cfg, dryRun: true, deleteRemoved: true }, deps, NOW);
    expect(mockedWrite).not.toHaveBeenCalled();
    expect(log.log).toHaveBeenCalledWith('  - 1 note line(s) whose SP task is gone (dry-run)');
  });

  it('removes nothing when the SP task list is empty (a failed read must not clear the note)', async () => {
    mockedRead.mockResolvedValue('## To Dos\n- [ ] <!--gone--> Old\n');
    setTasks([], []);
    await runDailyNoteDryRun({ ...cfg, dryRun: false, deleteRemoved: true }, deps, NOW);
    expect(mockedWrite).not.toHaveBeenCalled();
  });

  it('updates the checkbox of a note task that is not planned for today', async () => {
    mockedRead.mockResolvedValue('## To Dos\n- [ ] <!--other--> Not today\n');
    setTasks([{ id: 'other', title: 'Not today', isDone: true, projectId: 'S3' }], []);
    await runDailyNoteDryRun({ ...cfg, dryRun: false }, deps, NOW);
    expect(mockedWrite).toHaveBeenCalledWith('/vault/Daily/2026-10-21.md', '## To Dos\n- [x] <!--other--> Not today\n');
  });
});
