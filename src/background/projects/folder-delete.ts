import type { ProjectLinks } from './rename';

export interface DeletedFolder {
  projectId: string;
  folder: string;
}

/**
 * Find linked folders whose SP project was removed while the folder is still there.
 * A link counts only when its project is gone and its folder still exists. A folder
 * whose project was renamed keeps its project id, so it is not reported. Pure: no I/O.
 */
export const findRemovedProjectFolders = (
  links: ProjectLinks,
  folders: string[],
  projectIds: Set<string>,
): DeletedFolder[] => {
  const present = new Set(folders);
  return Object.entries(links)
    .filter(([projectId, folder]) => !/\.md$/i.test(folder) && present.has(folder) && !projectIds.has(projectId))
    .map(([projectId, folder]) => ({ projectId, folder }));
};

/**
 * Find linked folders that were deleted in the vault. A link counts only when its
 * folder is gone, its SP project still exists, and the project was not renamed in
 * this run (a rename is not a deletion). A manual bind to a .md file is not a
 * folder, so those are skipped. Pure: no I/O.
 */
export const findDeletedFolders = (
  links: ProjectLinks,
  folders: string[],
  projectIds: Set<string>,
  renamedProjectIds: Set<string>,
): DeletedFolder[] => {
  const present = new Set(folders);
  return Object.entries(links)
    .filter(
      ([projectId, folder]) =>
        !/\.md$/i.test(folder) &&
        !present.has(folder) &&
        projectIds.has(projectId) &&
        !renamedProjectIds.has(projectId),
    )
    .map(([projectId, folder]) => ({ projectId, folder }));
};
