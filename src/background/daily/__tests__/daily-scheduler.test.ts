import { scheduleDailyNoteRun, cancelDailyNoteRun, DAILY_NOTE_DEBOUNCE_MS } from '../daily-scheduler';
import { runDailyNoteDryRun } from '../daily-runner';
import { DEFAULT_DAILY_NOTE_CFG } from '../daily-note';

jest.mock('../daily-runner', () => ({ runDailyNoteDryRun: jest.fn().mockResolvedValue(undefined) }));

const mockedRun = runDailyNoteDryRun as jest.MockedFunction<typeof runDailyNoteDryRun>;
const cfg = { ...DEFAULT_DAILY_NOTE_CFG, enabled: true, vaultRoot: '/vault' };

beforeEach(() => {
  jest.useFakeTimers();
  mockedRun.mockClear();
});

afterEach(() => {
  cancelDailyNoteRun();
  jest.useRealTimers();
});

describe('daily-scheduler', () => {
  it('runs once after the debounce window', () => {
    scheduleDailyNoteRun(() => cfg);
    expect(mockedRun).not.toHaveBeenCalled();
    jest.advanceTimersByTime(DAILY_NOTE_DEBOUNCE_MS);
    expect(mockedRun).toHaveBeenCalledTimes(1);
  });

  it('collapses a burst of updates into a single run', () => {
    scheduleDailyNoteRun(() => cfg);
    jest.advanceTimersByTime(500);
    scheduleDailyNoteRun(() => cfg);
    jest.advanceTimersByTime(500);
    scheduleDailyNoteRun(() => cfg);
    jest.advanceTimersByTime(DAILY_NOTE_DEBOUNCE_MS);
    expect(mockedRun).toHaveBeenCalledTimes(1);
  });

  it('reads the config when it fires, not when scheduled', () => {
    let current = { ...cfg, enabled: false };
    scheduleDailyNoteRun(() => current);
    current = { ...cfg, enabled: true };
    jest.advanceTimersByTime(DAILY_NOTE_DEBOUNCE_MS);
    expect(mockedRun).toHaveBeenCalledWith(expect.objectContaining({ enabled: true }));
  });

  it('cancel prevents a pending run (onUnload path)', () => {
    scheduleDailyNoteRun(() => cfg);
    cancelDailyNoteRun();
    jest.advanceTimersByTime(DAILY_NOTE_DEBOUNCE_MS * 2);
    expect(mockedRun).not.toHaveBeenCalled();
  });
});
