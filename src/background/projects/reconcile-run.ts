import type { SyncBindingCfg } from '../local-config';
import type { ReconcilePlan } from './reconcile';
import { log } from '../../shared/logger';

export interface ReconcileDeps {
  // Create an SP project for a folder name, returns the new project id.
  createProject: (title: string) => Promise<string>;
  // Write the project's tasks to its task file (creates the folder when needed).
  writeBacklog: (binding: SyncBindingCfg) => Promise<void>;
}

/**
 * Carry out the reconcile plan. Write mode only: in dry-run it logs the intent and
 * changes nothing. A failure on one item is logged and does not stop the others.
 * Returns the number of items created.
 */
export const runProjectsReconcile = async (
  plan: ReconcilePlan,
  projectsDirAbs: string,
  taskFileName: string,
  dryRun: boolean,
  deps: ReconcileDeps,
): Promise<number> => {
  let created = 0;
  for (const folder of plan.projectsToCreate) {
    if (dryRun) {
      log.log(`would create SP project "${folder}"`);
      continue;
    }
    try {
      const id = await deps.createProject(folder);
      log.log(`created SP project "${folder}" (${id})`);
      created++;
    } catch (err) {
      log.error(`could not create SP project "${folder}"`, err);
    }
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
      log.log(`would create folder + ${taskFileName} for "${project.title}"`);
      continue;
    }
    try {
      await deps.writeBacklog(binding);
      log.log(`created folder + ${taskFileName} for "${project.title}"`);
      created++;
    } catch (err) {
      log.error(`could not create ${taskFileName} for "${project.title}"`, err);
    }
  }
  return created;
};
