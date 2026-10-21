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
  vaultRoot: string;
  // Delete the SP task when its plugin-written line is removed from the note.
  // Off by default; deletes only run in write mode.
  deleteRemoved: boolean;
}

export const DEFAULT_DAILY_NOTE_CFG: DailyNoteCfg = {
  enabled: false,
  dryRun: true,
  folder: 'Daily',
  filenameFormat: 'YYYY-MM-DD',
  includeInbox: true,
  vaultRoot: '',
  deleteRemoved: false,
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

/**
 * Vault-relative path of the daily note, e.g. "Daily/2026-10-21.md".
 * Throws if the folder or filename would escape the vault root.
 */
export const dailyNoteRelativePath = (cfg: DailyNoteCfg, date: Date): string => {
  const folder = cfg.folder.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  const filename = formatDailyFilename(cfg.filenameFormat, date);
  if (!filename || filename.includes('/') || filename.includes('..')) {
    throw new Error('[sync-md] Invalid daily note filename format');
  }
  const segments = folder ? folder.split('/') : [];
  if (segments.some((s) => s === '..' || s === '.' || s === '')) {
    throw new Error('[sync-md] Invalid daily note folder');
  }
  return [...segments, `${filename}.md`].join('/');
};

/** Task IDs planned for today: the members of SP's TODAY tag. */
export const plannedTaskIdsForToday = (tags: { id: string; taskIds: string[] }[]): string[] => {
  const today = tags.find((t) => t.id === TODAY_TAG_ID);
  return today ? [...today.taskIds] : [];
};

const TODOS_HEADING = '## To Dos';

/**
 * Locate the `## To Dos` body: from the line after the heading up to (not
 * including) the next `## ` heading or end of file. Null when absent.
 */
export const findToDosSection = (
  lines: string[],
): { headingIndex: number; bodyStart: number; bodyEnd: number } | null => {
  const headingIndex = lines.findIndex((l) => l.trim() === TODOS_HEADING);
  if (headingIndex === -1) return null;
  let bodyEnd = lines.length;
  for (let i = headingIndex + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) {
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
export const ensureToDosSection = (lines: string[]): string[] => {
  if (findToDosSection(lines)) return [...lines];
  const out = [...lines];
  if (out.length > 0 && out[out.length - 1].trim() !== '') out.push('');
  out.push(TODOS_HEADING);
  return out;
};

/** Merge stored (possibly partial) daily settings over the safe defaults. */
export const resolveDailyNoteCfg = (stored?: Partial<DailyNoteCfg>): DailyNoteCfg => ({
  ...DEFAULT_DAILY_NOTE_CFG,
  ...(stored ?? {}),
});

/**
 * Join a vault-relative path onto the absolute vault root, rejecting any result
 * outside it. Lexical check only; the caller is responsible for resolving
 * symlinks when a Node call is available.
 */
export const resolveInsideVault = (vaultRoot: string, relative: string): string => {
  const root = vaultRoot.replace(/\\/g, '/').replace(/\/+$/, '');
  if (!root.startsWith('/') && !/^[a-zA-Z]:\//.test(root)) {
    throw new Error('[sync-md] Vault root must be an absolute path');
  }
  const rel = relative.replace(/\\/g, '/');
  if (rel.startsWith('/') || rel.split('/').some((s) => s === '..')) {
    throw new Error('[sync-md] Daily note path escapes the vault');
  }
  return `${root}/${rel}`;
};
