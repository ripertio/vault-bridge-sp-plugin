import { DailyNoteCfg } from './daily-note';
import { runDailyNoteDryRun } from './daily-runner';

// Task edits can arrive in bursts; wait for a quiet period before running.
export const DAILY_NOTE_DEBOUNCE_MS = 2000;

let timer: ReturnType<typeof setTimeout> | null = null;

/** Debounced daily-note run. The config is read at fire time, not schedule time. */
export const scheduleDailyNoteRun = (getCfg: () => DailyNoteCfg): void => {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void runDailyNoteDryRun(getCfg()).catch(() => undefined);
  }, DAILY_NOTE_DEBOUNCE_MS);
};

/** Stop a pending run. Called from onUnload so no zombie timer survives reload. */
export const cancelDailyNoteRun = (): void => {
  if (timer) clearTimeout(timer);
  timer = null;
};
