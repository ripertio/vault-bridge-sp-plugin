import {
  scheduleDailyNoteRun,
  cancelDailyNoteRun,
  DAILY_NOTE_DEBOUNCE_MS,
  startDailyNoteWatcher,
  stopDailyNoteWatcher,
  startDayChangeCheck,
  stopDayChangeCheck,
  DAY_CHECK_INTERVAL_MS,
} from '../daily-scheduler';
import { runDailyNoteDryRun } from '../daily-runner';
import { DEFAULT_DAILY_NOTE_CFG } from '../daily-note';

jest.mock('../daily-runner', () => ({ runDailyNoteDryRun: jest.fn().mockResolvedValue(undefined) }));

const mockedRun = runDailyNoteDryRun as jest.MockedFunction<typeof runDailyNoteDryRun>;
const cfg = { ...DEFAULT_DAILY_NOTE_CFG, enabled: true, vaultPath: '/vault' };
const deps = { getBaseline: () => ({}), saveBaseline: jest.fn() };

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
    scheduleDailyNoteRun(() => cfg, deps);
    expect(mockedRun).not.toHaveBeenCalled();
    jest.advanceTimersByTime(DAILY_NOTE_DEBOUNCE_MS);
    expect(mockedRun).toHaveBeenCalledTimes(1);
  });

  it('collapses a burst of updates into a single run', () => {
    scheduleDailyNoteRun(() => cfg, deps);
    jest.advanceTimersByTime(500);
    scheduleDailyNoteRun(() => cfg, deps);
    jest.advanceTimersByTime(500);
    scheduleDailyNoteRun(() => cfg, deps);
    jest.advanceTimersByTime(DAILY_NOTE_DEBOUNCE_MS);
    expect(mockedRun).toHaveBeenCalledTimes(1);
  });

  it('reads the config when it fires, not when scheduled', () => {
    let current = { ...cfg, enabled: false };
    scheduleDailyNoteRun(() => current, deps);
    current = { ...cfg, enabled: true };
    jest.advanceTimersByTime(DAILY_NOTE_DEBOUNCE_MS);
    expect(mockedRun.mock.calls[0][0]).toEqual(expect.objectContaining({ enabled: true }));
  });

  it('cancel prevents a pending run (onUnload path)', () => {
    scheduleDailyNoteRun(() => cfg, deps);
    cancelDailyNoteRun();
    jest.advanceTimersByTime(DAILY_NOTE_DEBOUNCE_MS * 2);
    expect(mockedRun).not.toHaveBeenCalled();
  });
});

describe('daily-note watcher', () => {
  const deps2 = { getBaseline: () => ({}), saveBaseline: jest.fn() };

  it('does not watch when the feature is disabled', () => {
    const watch = jest.fn(() => () => undefined);
    startDailyNoteWatcher(() => ({ ...cfg, enabled: false }), deps2, watch);
    expect(watch).not.toHaveBeenCalled();
  });

  it('watches the day note path under the vault root when enabled', () => {
    const watch = jest.fn(() => () => undefined);
    startDailyNoteWatcher(() => cfg, deps2, watch);
    expect(watch).toHaveBeenCalledWith(expect.stringMatching(/^\/vault\/Daily\/\d{4}-\d{2}-\d{2}\.md$/), expect.any(Function));
  });

  it('a file change schedules a run', () => {
    let onChange: () => void = () => undefined;
    const watch = jest.fn((_p: string, cb: () => void) => {
      onChange = cb;
      return () => undefined;
    });
    startDailyNoteWatcher(() => cfg, deps2, watch);
    onChange();
    jest.advanceTimersByTime(DAILY_NOTE_DEBOUNCE_MS);
    expect(mockedRun).toHaveBeenCalledTimes(1);
  });

  it('stopDailyNoteWatcher calls the stop function', () => {
    const stop = jest.fn();
    startDailyNoteWatcher(() => cfg, deps2, () => stop);
    stopDailyNoteWatcher();
    expect(stop).toHaveBeenCalledTimes(1);
  });
});

describe('startDayChangeCheck', () => {
  afterEach(() => stopDayChangeCheck());

  it('calls back once when the local date changes', () => {
    jest.setSystemTime(new Date(2026, 9, 21, 12, 0, 0));
    const onDayChange = jest.fn();
    startDayChangeCheck(onDayChange);

    jest.advanceTimersByTime(DAY_CHECK_INTERVAL_MS);
    expect(onDayChange).not.toHaveBeenCalled();

    jest.setSystemTime(new Date(2026, 9, 22, 0, 0, 30));
    jest.advanceTimersByTime(DAY_CHECK_INTERVAL_MS);
    expect(onDayChange).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(DAY_CHECK_INTERVAL_MS);
    expect(onDayChange).toHaveBeenCalledTimes(1);
  });

  it('stops checking after stopDayChangeCheck', () => {
    jest.setSystemTime(new Date(2026, 9, 21, 12, 0, 0));
    const onDayChange = jest.fn();
    startDayChangeCheck(onDayChange);
    stopDayChangeCheck();

    jest.setSystemTime(new Date(2026, 9, 22, 0, 0, 30));
    jest.advanceTimersByTime(DAY_CHECK_INTERVAL_MS * 2);
    expect(onDayChange).not.toHaveBeenCalled();
  });
});
