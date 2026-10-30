/**
 * Pure helpers for the daily-note feature. No file or SP I/O happens here.
 */

export interface DailyNoteCfg {
  // Off by default. Nothing is read or written for daily notes unless enabled.
  enabled: boolean;
  // When true, only log what would be written. Never writes files.
  dryRun: boolean;
  // Vault-relative folder that holds daily notes, e.g. "Daily".
  folder: string;
  // Filename template. Tokens: YYYY, MM, DD.
  filenameFormat: string;
  // Include Inbox tasks in the daily note.
  includeInbox: boolean;
  // Absolute vault root. Every daily-note path must resolve inside it.
  vaultPath: string;
  // Delete the SP task when its plugin-written line is removed from the note.
  // Off by default; deletes only run in write mode.
  deleteRemoved: boolean;
  // Once per day, carry unfinished tasks from the last earlier note into today's
  // ## To Dos. Off by default; in dry-run it only logs what would be carried.
  rolloverOverdue: boolean;
  // Heading line of the section tasks are added under, e.g. "## To Dos".
  todosHeading: string;
}

export const DEFAULT_DAILY_NOTE_CFG: DailyNoteCfg = {
  enabled: false,
  dryRun: true,
  folder: 'Daily',
  filenameFormat: 'YYYY-MM-DD',
  includeInbox: true,
  vaultPath: '',
  deleteRemoved: false,
  rolloverOverdue: false,
  todosHeading: '## To Dos',
};

// SP's virtual "Today" tag ID. Observed in the SP 19.2.0 bundle; not yet
// confirmed as documented API, so keep it isolated here.
export const TODAY_TAG_ID = 'TODAY';

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** Replace YYYY / MM / DD in a filename template using the local calendar date. */
export const formatDailyFilename = (format: string, date: Date): string =>
  format
    .replace(/YYYY/g, String(date.getFullYear()))
    .replace(/MM/g, pad2(date.getMonth() + 1))
    .replace(/DD/g, pad2(date.getDate()));

/** Local date as an ISO day (YYYY-MM-DD), the format SP uses for dueDay. */
export const isoDay = (date: Date): string => formatDailyFilename('YYYY-MM-DD', date);

/**
 * Scheduling field SP applies to tasks (upstream PluginCreateTaskData.dueDay).
 * The installed @super-productivity/plugin-api 1.0.1 types do not declare it, so
 * it is added here in one place instead of casting at each call site.
 */
export interface ScheduledTaskFields {
  dueDay?: string | null;
}

/**
 * Vault-relative path of the daily note, e.g. "Daily/2026-10-21.md".
 * Throws if the folder or filename would escape the vault root.
 */
export const dailyNoteRelativePath = (cfg: DailyNoteCfg, date: Date): string => {
  const folder = cfg.folder.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  const filename = formatDailyFilename(cfg.filenameFormat, date);
  if (!filename || filename.includes('/') || filename.includes('..')) {
    throw new Error('[vault-bridge] Invalid daily note filename format');
  }
  const segments = folder ? folder.split('/') : [];
  if (segments.some((s) => s === '..' || s === '.' || s === '')) {
    throw new Error('[vault-bridge] Invalid daily note folder');
  }
  return [...segments, `${filename}.md`].join('/');
};

/** Task IDs planned for today: the members of SP's TODAY tag. */
export const plannedTaskIdsForToday = (tags: { id: string; taskIds: string[] }[]): string[] => {
  const today = tags.find((t) => t.id === TODAY_TAG_ID);
  return today ? [...today.taskIds] : [];
};

/**
 * True when the task was completed on a day before `today` (YYYY-MM-DD). A task that is
 * not done, or has no completion time (e.g. after an import), is never "completed before".
 */
export const completedBefore = (
  task: { isDone: boolean; doneOn?: number | null },
  today: string,
): boolean => task.isDone && !!task.doneOn && isoDay(new Date(task.doneOn)) < today;

/**
 * Heading line from user input: trimmed, and given `## ` when it has no `#` prefix.
 * Empty input falls back to the default.
 */
export const normalizeTodosHeading = (input: string | undefined): string => {
  const text = (input ?? '').trim();
  if (!text) return DEFAULT_DAILY_NOTE_CFG.todosHeading;
  return /^#{1,6}\s/.test(text) ? text.replace(/\s+/g, ' ') : `## ${text}`;
};

/**
 * Locate the To Dos body: from the line after the heading up to (not including)
 * the next heading of the same or a higher level, or end of file. Null when absent.
 */
export const findToDosSection = (
  lines: string[],
  heading: string = DEFAULT_DAILY_NOTE_CFG.todosHeading,
): { headingIndex: number; bodyStart: number; bodyEnd: number } | null => {
  const wanted = normalizeTodosHeading(heading);
  const level = wanted.indexOf(' ');
  const headingIndex = lines.findIndex((l) => l.trim().replace(/\s+/g, ' ') === wanted);
  if (headingIndex === -1) return null;
  const endsSection = new RegExp(`^#{1,${level}}\\s`);
  let bodyEnd = lines.length;
  for (let i = headingIndex + 1; i < lines.length; i++) {
    if (endsSection.test(lines[i])) {
      bodyEnd = i;
      break;
    }
  }
  return { headingIndex, bodyStart: headingIndex + 1, bodyEnd };
};

/**
 * Return lines with `## To Dos` present, appending the heading when missing.
 * Existing content is never removed or reordered.
 */
export const ensureToDosSection = (
  lines: string[],
  heading: string = DEFAULT_DAILY_NOTE_CFG.todosHeading,
): string[] => {
  if (findToDosSection(lines, heading)) return [...lines];
  const out = [...lines];
  if (out.length > 0 && out[out.length - 1].trim() !== '') out.push('');
  out.push(normalizeTodosHeading(heading));
  return out;
};

/** Merge stored (possibly partial) daily settings over the safe defaults. */
export const resolveDailyNoteCfg = (stored?: Partial<DailyNoteCfg> & { vaultRoot?: string }): DailyNoteCfg => {
  // Settings saved before the rename stored the vault as `vaultRoot`.
  const { vaultRoot, ...rest } = stored ?? {};
  return {
    ...DEFAULT_DAILY_NOTE_CFG,
    ...(vaultRoot && !rest.vaultPath ? { vaultPath: vaultRoot } : {}),
    ...rest,
  };
};

/**
 * Join a vault-relative path onto the absolute vault root, rejecting any result
 * outside it. Lexical check only; the caller is responsible for resolving
 * symlinks when a Node call is available.
 */
export const resolveInsideVault = (vaultPath: string, relative: string): string => {
  const root = vaultPath.replace(/\\/g, '/').replace(/\/+$/, '');
  if (!root.startsWith('/') && !/^[a-zA-Z]:\//.test(root)) {
    throw new Error('[vault-bridge] Vault root must be an absolute path');
  }
  const rel = relative.replace(/\\/g, '/');
  if (rel.startsWith('/') || rel.split('/').some((s) => s === '..')) {
    throw new Error('[vault-bridge] Daily note path escapes the vault');
  }
  return `${root}/${rel}`;
};
