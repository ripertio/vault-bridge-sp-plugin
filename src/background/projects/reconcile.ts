import type { FolderMatchResult, ProjectRef } from './project-dir';

export interface ReconcilePlan {
  // Folders with no SP project: create the project (write mode only).
  projectsToCreate: string[];
  // SP projects with no folder: create folder + backlog.md (write mode only).
  foldersToCreate: ProjectRef[];
  // Folder names that match more than one project. Left alone.
  ambiguous: string[];
}

/**
 * Decide what the projects-folder sync should create. Pure: no I/O. Only the
 * creation candidates from the matcher are returned; nothing is ever removed.
 */
export const planReconcile = (match: FolderMatchResult): ReconcilePlan => ({
  projectsToCreate: [...match.foldersWithoutProject],
  foldersToCreate: [...match.projectsWithoutFolder],
  ambiguous: [...match.ambiguous],
});
