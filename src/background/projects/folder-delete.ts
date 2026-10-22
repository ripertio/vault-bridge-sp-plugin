import type { ProjectLinks } from './rename';

export interface DeletedFolder {
  projectId: string;
  folder: string;
}

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
