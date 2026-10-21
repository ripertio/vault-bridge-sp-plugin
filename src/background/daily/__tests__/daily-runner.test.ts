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
    await runDailyNoteDryRun({ ...cfg, enabled: false }, NOW);
    expect(mockedRead).not.toHaveBeenCalled();
    expect(log.log).not.toHaveBeenCalled();
  });

  it('refuses to run without a vault root', async () => {
    setSp(['p1']);
    await runDailyNoteDryRun({ ...cfg, vaultRoot: '' }, NOW);
    expect(log.error).toHaveBeenCalled();
    expect(mockedRead).not.toHaveBeenCalled();
  });

  it('reads the day note under the vault root and logs the planned tasks', async () => {
    setSp(['p1', 'i1']);
    await runDailyNoteDryRun(cfg, NOW);
    expect(mockedRead).toHaveBeenCalledWith('/vault/Daily/2026-10-21.md');
    expect(log.log).toHaveBeenCalledWith('would add 2 task(s) to ## To Dos');
  });

  it('only plans tasks that are in the TODAY tag', async () => {
    setSp(['p1']);
    await runDailyNoteDryRun(cfg, NOW);
    expect(log.log).toHaveBeenCalledWith('would add 1 task(s) to ## To Dos');
  });

  it('never writes a file or mutates SP', async () => {
    setSp(['p1', 'i1']);
    await runDailyNoteDryRun(cfg, NOW);
    expect(mockedWrite).not.toHaveBeenCalled();
    const api = (global as any).PluginAPI;
    expect(api.getTasks).toHaveBeenCalled();
    expect(api.updateTask).toBeUndefined();
    expect(api.addTask).toBeUndefined();
  });

  it('rejects a folder that escapes the vault before any read', async () => {
    setSp(['p1']);
    await expect(
      runDailyNoteDryRun({ ...cfg, folder: '../outside' }, NOW),
    ).rejects.toThrow();
    expect(mockedRead).not.toHaveBeenCalled();
  });
});
