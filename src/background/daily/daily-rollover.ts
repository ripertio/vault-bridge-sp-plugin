import { DailyNoteCfg, dailyNoteRelativePath, findToDosSection, resolveInsideVault } from './daily-note';
import { parseNoteTaskLine } from './daily-reverse';

// How many days back to look for the last earlier note. Covers a weekend or a short break.
export const ROLLOVER_LOOKBACK_DAYS = 7;

/**
 * IDs of unchecked task lines in a note's ## To Dos whose SP task still exists and
 * is not done. Pure: no I/O.
 */
export const findOverdueIds = (lines: string[], spIsDone: Record<string, boolean>): Set<string> => {
  const ids = new Set<string>();
  const section = findToDosSection(lines);
  if (!section) return ids;
  for (let i = section.bodyStart; i < section.bodyEnd; i++) {
    const parsed = parseNoteTaskLine(lines[i]);
    if (parsed && !parsed.isDone && spIsDone[parsed.id] === false) ids.add(parsed.id);
  }
  return ids;
};

/**
 * Content of the most recent daily note before `now`, within the lookback window.
 * Null when none exists. Reads go through `read` so the caller owns the I/O.
 */
export const readPreviousNote = async (
  cfg: DailyNoteCfg,
  now: Date,
  read: (path: string) => Promise<string | null>,
): Promise<{ day: Date; lines: string[] } | null> => {
  for (let back = 1; back <= ROLLOVER_LOOKBACK_DAYS; back++) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - back);
    const content = await read(resolveInsideVault(cfg.vaultPath, dailyNoteRelativePath(cfg, day)));
    if (content !== null) return { day, lines: content === '' ? [] : content.split('\n') };
  }
  return null;
};

/** Return lines with `newLines` inserted after the last non-blank line of the section body. */
export const insertIntoSection = (
  lines: string[],
  section: { bodyStart: number; bodyEnd: number },
  newLines: string[],
): string[] => {
  let insertAt = section.bodyEnd;
  while (insertAt > section.bodyStart && lines[insertAt - 1].trim() === '') insertAt--;
  return [...lines.slice(0, insertAt), ...newLines, ...lines.slice(insertAt)];
};
