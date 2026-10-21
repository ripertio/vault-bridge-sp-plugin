import { INBOX_PROJECT_ID } from '../daily/daily-plan';

export interface ProjectsDirCfg {
  // Off by default. When on, the folders under projectsDir define the bindings.
  enabled: boolean;
  // Folder holding one sub-folder per project, relative to the vault path.
  projectsDir: string;
  // Names excluded from sync on both sides (folder names and project titles).
  excluded: string[];
}

export const DEFAULT_PROJECTS_DIR_CFG: ProjectsDirCfg = {
  enabled: false,
  projectsDir: 'Projects',
  excluded: [],
};

export type ProjectsDirValidation =
  | { ok: true; cfg: ProjectsDirCfg }
  | { ok: false; error: string };

export const resolveProjectsDirCfg = (stored?: Partial<ProjectsDirCfg>): ProjectsDirCfg => ({
  ...DEFAULT_PROJECTS_DIR_CFG,
  ...(stored ?? {}),
});

const isAbsolute = (p: string): boolean => p.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(p);

/**
 * Validate the projects-directory settings. The directory must be relative to the
 * vault path and must not escape it. Excluded names are trimmed, de-duplicated and
 * empty entries are dropped.
 */
export const validateProjectsDirCfg = (input: Partial<ProjectsDirCfg>): ProjectsDirValidation => {
  const cfg = resolveProjectsDirCfg(input);
  const projectsDir = (cfg.projectsDir ?? '').trim().replace(/[\\/]+$/, '');
  if (!projectsDir) return { ok: false, error: 'Projects folder is required.' };
  if (isAbsolute(projectsDir)) return { ok: false, error: 'Projects folder must be relative to the vault path.' };
  if (projectsDir.split(/[\\/]/).some((s) => s === '..' || s === '.')) {
    return { ok: false, error: 'Projects folder must stay inside the vault.' };
  }
  const excluded = [...new Set((cfg.excluded ?? []).map((e) => e.trim()).filter((e) => e.length > 0))];
  return { ok: true, cfg: { ...cfg, projectsDir, excluded } };
};

export interface ProjectRef {
  id: string;
  title: string;
}

export interface FolderMatchResult {
  // Folder name matched to exactly one SP project.
  matched: { folder: string; projectId: string }[];
  // Folders with no SP project of the same title (candidates for creating a project).
  foldersWithoutProject: string[];
  // SP projects with no folder (candidates for creating a folder with backlog.md).
  projectsWithoutFolder: ProjectRef[];
  // Names that match more than one SP project. Never synced automatically.
  ambiguous: string[];
}

/**
 * Match folder names to SP project titles by exact title. Excluded names are
 * skipped on both sides, and the Inbox is never treated as a project folder.
 * Pure: no I/O.
 */
export const matchFoldersToProjects = (
  folders: string[],
  projects: ProjectRef[],
  excluded: string[],
): FolderMatchResult => {
  const skip = new Set(excluded);
  const eligible = projects.filter((p) => p.id !== INBOX_PROJECT_ID && !skip.has(p.title));

  const byTitle = new Map<string, ProjectRef[]>();
  for (const p of eligible) byTitle.set(p.title, [...(byTitle.get(p.title) ?? []), p]);

  const result: FolderMatchResult = {
    matched: [],
    foldersWithoutProject: [],
    projectsWithoutFolder: [],
    ambiguous: [],
  };
  const seenFolders = new Set<string>();

  for (const folder of folders) {
    if (skip.has(folder) || seenFolders.has(folder)) continue;
    seenFolders.add(folder);
    const hits = byTitle.get(folder) ?? [];
    if (hits.length === 1) result.matched.push({ folder, projectId: hits[0].id });
    else if (hits.length > 1) result.ambiguous.push(folder);
    else result.foldersWithoutProject.push(folder);
  }

  for (const p of eligible) {
    if (!seenFolders.has(p.title)) result.projectsWithoutFolder.push(p);
  }
  return result;
};

/** A plain folder name: non-empty, no separators, not '.' or '..'. */
export const validFolderName = (name: string): boolean =>
  name.length > 0 && !/[\\/]/.test(name) && name !== '.' && name !== '..';
