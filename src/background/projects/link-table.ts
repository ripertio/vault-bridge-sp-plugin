import type { ProjectRef } from './project-dir';
import { matchFoldersToProjects } from './project-dir';

export type LinkState = 'linked' | 'folder-only' | 'project-only' | 'excluded' | 'ambiguous';

export interface LinkRow {
  // Display name: the folder name, or the project title when there is no folder.
  name: string;
  folder: string | null;
  projectId: string | null;
  projectTitle: string | null;
  state: LinkState;
}

/**
 * Rows for the link table: one per folder and per SP project, joined the same way
 * the sync matches them (exact title, Inbox excluded, excluded names skipped).
 * Pure: the table and the sync cannot disagree because both use the matcher.
 */
export const buildLinkTable = (
  folders: string[],
  projects: ProjectRef[],
  excluded: string[],
  folderBinds: Record<string, string> = {},
): LinkRow[] => {
  const skip = new Set(excluded);
  const match = matchFoldersToProjects(folders, projects, excluded, folderBinds);
  const rows: LinkRow[] = [];

  for (const m of match.matched) {
    const p = projects.find((x) => x.id === m.projectId);
    rows.push({ name: m.folder, folder: m.folder, projectId: m.projectId, projectTitle: p?.title ?? m.folder, state: 'linked' });
  }
  for (const f of match.foldersWithoutProject) {
    rows.push({
      name: f,
      folder: f,
      projectId: null,
      projectTitle: null,
      state: skip.has(f) ? 'excluded' : 'folder-only',
    });
  }
  for (const p of match.projectsWithoutFolder) {
    rows.push({ name: p.title, folder: null, projectId: p.id, projectTitle: p.title, state: 'project-only' });
  }
  for (const a of match.ambiguous) {
    rows.push({ name: a, folder: a, projectId: null, projectTitle: null, state: 'ambiguous' });
  }
  for (const e of excluded) {
    if (!rows.some((r) => r.name === e)) {
      rows.push({ name: e, folder: folders.includes(e) ? e : null, projectId: null, projectTitle: null, state: 'excluded' });
    }
  }
  return rows;
};

/** Ignore a row: exclude its name on both sides. Returns the new excluded list. */
export const ignoreRow = (excluded: string[], name: string): string[] =>
  excluded.includes(name) ? [...excluded] : [...excluded, name];

/** Un-ignore a row: remove its name from the excluded list. */
export const unignoreRow = (excluded: string[], name: string): string[] =>
  excluded.filter((e) => e !== name);
