import { INBOX_PROJECT_ID } from '../daily/daily-plan';

export interface ProjectsDirCfg {
  // Off by default. When on, the folders under projectsDir define the bindings.
  enabled: boolean;
  // Folder holding one sub-folder per project, relative to the vault path.
  projectsDir: string;
  // Names excluded from sync on both sides (folder names and project titles).
  excluded: string[];
  // Manual links: folder path (relative to projectsDir, e.g. "Inbox/backlog.md") →
  // SP project ID. A manual link wins over the title match.
  folderBinds?: Record<string, string>;
  // Markdown file name created in each project folder and synced with its SP project.
  taskFileName: string;
  // Off by default. When on, deleting a linked folder asks in SP whether to remove the
  // project or unlink it. Nothing is removed without that answer.
  confirmFolderDelete: boolean;
  // Off by default. When on, a project removed in SP adds its folder name to the
  // excluded list, so the folder is not offered for a new project again.
  excludeRemovedProjects: boolean;
}

export const DEFAULT_PROJECTS_DIR_CFG: ProjectsDirCfg = {
  enabled: false,
  projectsDir: 'Projects',
  excluded: [],
  folderBinds: {},
  taskFileName: 'backlog.md',
  confirmFolderDelete: false,
  excludeRemovedProjects: false,
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
  const taskFileName = (cfg.taskFileName ?? '').trim();
  if (!taskFileName) return { ok: false, error: 'Task file name is required.' };
  if (!validFolderName(taskFileName) || !/\.md$/i.test(taskFileName)) {
    return { ok: false, error: 'Task file name must be a .md file name without folders.' };
  }
  return { ok: true, cfg: { ...cfg, projectsDir, excluded, taskFileName } };
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
  // SP projects with no folder (candidates for creating a folder with a task file).
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
  folderBinds: Record<string, string> = {},
): FolderMatchResult => {
  const skip = new Set(excluded);
  const eligible = projects.filter((p) => p.id !== INBOX_PROJECT_ID && !skip.has(p.title));

  // Manual links first: a bound folder pairs with its chosen project and is not
  // considered again by title. Both sides must still exist and not be excluded.
  const eligibleIds = new Set(eligible.map((p) => p.id));
  const manual = new Map<string, string>();
  for (const [folder, projectId] of Object.entries(folderBinds)) {
    if (folders.includes(folder) && eligibleIds.has(projectId) && !skip.has(folder)) {
      manual.set(folder, projectId);
    }
  }
  const boundProjectIds = new Set(manual.values());
  const unboundProjects = eligible.filter((p) => !boundProjectIds.has(p.id));

  const byTitle = new Map<string, ProjectRef[]>();
  for (const p of unboundProjects) byTitle.set(p.title, [...(byTitle.get(p.title) ?? []), p]);

  const result: FolderMatchResult = {
    matched: [],
    foldersWithoutProject: [],
    projectsWithoutFolder: [],
    ambiguous: [],
  };
  const seenFolders = new Set<string>();

  for (const [folder, projectId] of manual) {
    seenFolders.add(folder);
    result.matched.push({ folder, projectId });
  }

  for (const folder of folders) {
    if (skip.has(folder) || seenFolders.has(folder)) continue;
    seenFolders.add(folder);
    const hits = byTitle.get(folder) ?? [];
    if (hits.length === 1) result.matched.push({ folder, projectId: hits[0].id });
    else if (hits.length > 1) result.ambiguous.push(folder);
    else result.foldersWithoutProject.push(folder);
  }

  const linkedProjectIds = new Set(result.matched.map((m) => m.projectId));
  for (const p of eligible) {
    if (!linkedProjectIds.has(p.id) && !seenFolders.has(p.title)) result.projectsWithoutFolder.push(p);
  }
  return result;
};

/** A plain folder name: non-empty, no separators, not '.' or '..'. */
export const validFolderName = (name: string): boolean =>
  name.length > 0 && !/[\\/]/.test(name) && name !== '.' && name !== '..';

/**
 * A manual bind's folder must be a markdown file path inside the projects folder:
 * relative, no '..', ending in .md. Pure.
 */
export const validBindFile = (relative: string): boolean => {
  const p = relative.replace(/\\/g, '/');
  if (!p || p.startsWith('/') || /^[a-zA-Z]:/.test(p)) return false;
  if (p.split('/').some((seg) => seg === '..' || seg === '.' || seg === '')) return false;
  return /\.md$/i.test(p);
};
