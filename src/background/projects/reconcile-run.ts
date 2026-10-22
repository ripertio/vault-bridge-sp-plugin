import type { SyncBindingCfg } from '../local-config';
import type { ReconcilePlan } from './reconcile';
import { log } from '../../shared/logger';

export interface ReconcileDeps {
  // Ask the user in SP whether to create a project for a folder name. Nothing is
  // created here; the answer comes from the dialog's button.
  askCreateProject: (folder: string) => void;
  // Ask the user in SP whether to create the folder and task file for a project.
  // The binding says where the folder and task file go.
  askCreateFolder: (projectTitle: string, binding: SyncBindingCfg) => void;
}

/**
 * Carry out the reconcile plan. Write mode only: in dry-run it logs the intent and
 * changes nothing. Nothing is created here directly: both directions are handed to
 * the ask callbacks, and the user's answer in SP does the create.
 */
export const runProjectsReconcile = (
  plan: ReconcilePlan,
  projectsDirAbs: string,
  taskFileName: string,
  dryRun: boolean,
  deps: ReconcileDeps,
): void => {
  for (const folder of plan.projectsToCreate) {
    if (dryRun) {
      log.log(`would ask whether to create SP project "${folder}"`);
      continue;
    }
    deps.askCreateProject(folder);
  }

  for (const project of plan.foldersToCreate) {
    const binding: SyncBindingCfg = {
      id: `auto-${project.id}`,
      filePath: `${projectsDirAbs.replace(/[\\/]+$/, '')}/${project.title}/${taskFileName}`,
      projectId: project.id,
      enabled: true,
      projectTitle: project.title,
    };
    if (dryRun) {
      log.log(`would ask whether to create folder + ${taskFileName} for "${project.title}"`);
      continue;
    }
    deps.askCreateFolder(project.title, binding);
  }
};
