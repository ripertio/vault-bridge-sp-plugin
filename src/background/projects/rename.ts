import type { ProjectRef } from './project-dir';

// projectId → folder name, recorded after each successful match or create. The
// project ID is the stable identity, so a title or folder rename can be told apart
// from "delete one, create another".
export type ProjectLinks = Record<string, string>;

export interface RenamePlan {
  // SP project renamed in the folder: rename the folder to the new project title.
  renameFolders: { from: string; to: string; projectId: string }[];
  // Folder renamed in the vault: rename the SP project to the new folder name.
  renameProjects: { projectId: string; from: string; to: string }[];
}

/**
 * Detect renames by comparing the saved links with the current state. Pure.
 *
 * A link is a rename candidate only when exactly one side changed. If both sides
 * changed to different names, nothing is done (ambiguous). A rename target that
 * is already used by another folder or project is also skipped, so nothing is
 * overwritten.
 */
export const planRenames = (
  links: ProjectLinks,
  folders: string[],
  projects: ProjectRef[],
): RenamePlan => {
  const folderSet = new Set(folders);
  const projectById = new Map(projects.map((p) => [p.id, p]));
  const usedTitles = new Set(projects.map((p) => p.title));
  const plan: RenamePlan = { renameFolders: [], renameProjects: [] };

  for (const [projectId, oldFolder] of Object.entries(links)) {
    const project = projectById.get(projectId);
    const oldFolderExists = folderSet.has(oldFolder);
    if (!project) continue; // project deleted: not a rename, never handled here

    const projectRenamed = project.title !== oldFolder;
    const folderRenamed = !oldFolderExists;

    if (projectRenamed && oldFolderExists) {
      // SP side changed; the folder still has the old name.
      if (folderSet.has(project.title)) continue; // target taken: skip
      plan.renameFolders.push({ from: oldFolder, to: project.title, projectId });
    } else if (folderRenamed && !projectRenamed) {
      // Folder side changed: find the new folder name. Only one unlinked folder may
      // be the target, otherwise it is ambiguous.
      const unlinked = folders.filter((f) => !Object.values(links).includes(f));
      if (unlinked.length !== 1) continue;
      if (usedTitles.has(unlinked[0])) continue; // a project already has that name
      plan.renameProjects.push({ projectId, from: project.title, to: unlinked[0] });
    }
  }
  return plan;
};
