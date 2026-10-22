import { parseNoteTaskLine } from './daily-reverse';

export interface NewNoteTask {
  lineIndex: number;
  title: string;
  isDone: boolean;
}

const CHECK_RE = /^(\s*[-*]\s*\[)([ xX])(\]\s*)(.*)$/;

/**
 * Find lines inside `## To Dos` that are tasks without an SP ID. These are the
 * tasks the user typed into the note. Pure: no I/O.
 */
export const findNewTaskLines = (lines: string[], bodyStart: number, bodyEnd: number): NewNoteTask[] => {
  const found: NewNoteTask[] = [];
  for (let i = bodyStart; i < bodyEnd; i++) {
    const line = lines[i];
    if (parseNoteTaskLine(line)) continue;
    const m = CHECK_RE.exec(line);
    if (!m) continue;
    const title = m[4].trim();
    if (!title) continue;
    found.push({ lineIndex: i, title, isDone: m[2].toLowerCase() === 'x' });
  }
  return found;
};

/** Write an SP ID into a new task line, keeping its checkbox, indent and title. */
export const stampNewTaskLine = (line: string, id: string): string => {
  const m = CHECK_RE.exec(line);
  if (!m) return line;
  return `${m[1]}${m[2]}${m[3]}<!--${id}--> ${m[4].trim()}`;
};

/**
 * Stamp IDs into note text that changed after the stamps were made. A line is matched by
 * its exact text, so a line the user edited or deleted is not stamped and is counted in `unmatched`.
 */
export const stampCreatedLines = (
  text: string,
  stamps: { original: string; stamped: string }[],
): { text: string; unmatched: number } => {
  const lines = text.split('\n');
  let unmatched = 0;
  for (const s of stamps) {
    const i = lines.indexOf(s.original);
    if (i === -1) unmatched++;
    else lines[i] = s.stamped;
  }
  return { text: lines.join('\n'), unmatched };
};
