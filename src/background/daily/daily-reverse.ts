export interface BaselineEntry {
  isDone: boolean;
  title: string;
}

export type DailyBaseline = Record<string, BaselineEntry>;

export interface NoteTaskLine {
  id: string;
  isDone: boolean;
  title: string;
}

export interface ReverseChange {
  taskId: string;
  updates: { isDone?: boolean; title?: string };
}

const LINE_RE = /^\s*[-*]\s*\[([ xX])\]\s*<!--([^>]+?)-->\s?(.*)$/;

/** Parse a note line written by the plugin. Returns null for lines without an ID marker. */
export const parseNoteTaskLine = (line: string): NoteTaskLine | null => {
  const m = LINE_RE.exec(line);
  if (!m) return null;
  return { id: m[2], isDone: m[1].toLowerCase() === 'x', title: m[3].trim() };
};

/**
 * Compare note lines to the last agreed baseline and return SP updates.
 * Only IDs present in the baseline are considered (the plugin's own lines).
 * SP wins for the checkbox when both sides changed since the baseline.
 * Pure: no I/O, and never creates or deletes tasks.
 */
export const diffNoteAgainstBaseline = (
  lines: string[],
  baseline: DailyBaseline,
  spIsDone: Record<string, boolean>,
): ReverseChange[] => {
  const changes: ReverseChange[] = [];
  for (const line of lines) {
    const parsed = parseNoteTaskLine(line);
    if (!parsed || !(parsed.id in baseline)) continue;
    const base = baseline[parsed.id];
    const updates: ReverseChange['updates'] = {};

    const noteDoneChanged = parsed.isDone !== base.isDone;
    const spDoneChanged = parsed.id in spIsDone && spIsDone[parsed.id] !== base.isDone;
    if (noteDoneChanged && !spDoneChanged) {
      updates.isDone = parsed.isDone;
    }

    if (parsed.title !== base.title) {
      updates.title = parsed.title;
    }

    if (Object.keys(updates).length > 0) {
      changes.push({ taskId: parsed.id, updates });
    }
  }
  return changes;
};
