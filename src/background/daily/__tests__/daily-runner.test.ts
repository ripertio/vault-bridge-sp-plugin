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
const deps = { getBaseline: () => ({}), saveBaseline: jest.fn() };
const ROOT = '/vault';
const cfg = { ...DEFAULT_DAILY_NOTE_CFG, enabled: true, vaultRoot: ROOT };

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
    await runDailyNoteDryRun({ ...cfg, vaultRoot: '' }, deps, NOW);
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
    expect(saveBaseline).toHaveBeenCalledWith({ p1: { isDone: false, title: 'Project task' } });
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
