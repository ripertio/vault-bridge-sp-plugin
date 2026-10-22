import type { SyncBindingCfg } from '../local-config';
import { ProjectsDirCfg, matchFoldersToProjects, ProjectRef } from './project-dir';
import { bindingsFromMatches } from './auto-bindings';

export type EffectiveBindingsResult =
  | { ok: true; bindings: SyncBindingCfg[] }
  | { ok: false; error: string };

/**
 * Bindings to run. Manual mode returns the saved list unchanged. Auto mode (the
 * projects folder is enabled) replaces it: one binding per folder that matches an
 * SP project by exact title. If the folder scan fails, auto mode runs nothing
 * rather than falling back to the manual list.
 */
export const computeEffectiveBindings = async (
  manual: SyncBindingCfg[],
  projectsDir: ProjectsDirCfg,
  vaultPath: string,
  deps: {
    listFolders: (dir: string) => Promise<string[]>;
    getProjects: () => Promise<ProjectRef[]>;
  },
): Promise<EffectiveBindingsResult> => {
  if (!projectsDir.enabled) return { ok: true, bindings: manual };
  if (!vaultPath) return { ok: false, error: 'Auto mode needs a vault path.' };

  const absDir = `${vaultPath.replace(/[\\/]+$/, '')}/${projectsDir.projectsDir}`;
  try {
    const [folders, projects] = await Promise.all([deps.listFolders(absDir), deps.getProjects()]);
    const match = matchFoldersToProjects(folders, projects, projectsDir.excluded, projectsDir.folderBinds ?? {});
    const titles = Object.fromEntries(projects.map((p) => [p.id, p.title]));
    return { ok: true, bindings: bindingsFromMatches(match, absDir, titles, projectsDir.taskFileName) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
};
