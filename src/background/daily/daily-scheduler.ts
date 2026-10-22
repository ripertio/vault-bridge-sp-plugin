import { DailyNoteCfg, dailyNoteRelativePath, isoDay, resolveInsideVault } from './daily-note';
import { runDailyNoteDryRun, DailyRunDeps } from './daily-runner';

// Task edits can arrive in bursts; wait for a quiet period before running.
export const DAILY_NOTE_DEBOUNCE_MS = 2000;

// How often to compare the local date. A midnight change is noticed within a minute.
export const DAY_CHECK_INTERVAL_MS = 60_000;

let timer: ReturnType<typeof setTimeout> | null = null;

/** Debounced daily-note run. The config is read at fire time, not schedule time. */
export const scheduleDailyNoteRun = (getCfg: () => DailyNoteCfg, deps: DailyRunDeps): void => {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void runDailyNoteDryRun(getCfg(), deps).catch(() => undefined);
  }, DAILY_NOTE_DEBOUNCE_MS);
};

/** Stop a pending run. Called from onUnload so no zombie timer survives reload. */
export const cancelDailyNoteRun = (): void => {
  if (timer) clearTimeout(timer);
  timer = null;
};

let stopWatcher: (() => void) | null = null;

/**
 * Watch the day's note and run the daily sync when the user edits it. The path is
 * recomputed each poll, so the watcher follows the date at midnight. The runner
 * no-ops when the feature is disabled, so the watcher is cheap when off.
 */
export const startDailyNoteWatcher = (
  getCfg: () => DailyNoteCfg,
  deps: DailyRunDeps,
  watch: (path: string, onChange: () => void) => () => void,
): void => {
  stopDailyNoteWatcher();
  const cfg = getCfg();
  if (!cfg.enabled || !cfg.vaultPath) return;
  const path = resolveInsideVault(cfg.vaultPath, dailyNoteRelativePath(cfg, new Date()));
  stopWatcher = watch(path, () => scheduleDailyNoteRun(getCfg, deps));
};

export const stopDailyNoteWatcher = (): void => {
  if (stopWatcher) stopWatcher();
  stopWatcher = null;
};

let dayTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Call onDayChange once each time the local date changes (midnight). The note
 * path is date-based, so the caller re-points the watcher and syncs the new day's note.
 */
export const startDayChangeCheck = (onDayChange: () => void): void => {
  stopDayChangeCheck();
  let day = isoDay(new Date());
  dayTimer = setInterval(() => {
    const today = isoDay(new Date());
    if (today === day) return;
    day = today;
    onDayChange();
  }, DAY_CHECK_INTERVAL_MS);
};

export const stopDayChangeCheck = (): void => {
  if (dayTimer) clearInterval(dayTimer);
  dayTimer = null;
};
