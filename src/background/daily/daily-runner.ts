import { readTasksFile, writeTasksFile } from '../helper/file-utils';
import { log } from '../../shared/logger';
import {
  DailyNoteCfg,
  dailyNoteRelativePath,
  plannedTaskIdsForToday,
  resolveInsideVault,
} from './daily-note';
import { planDailyNote, DailyPlanTask } from './daily-plan';

/**
 * Dry-run only: reads SP's Today membership and the day's note, then logs what
 * would be added. It never calls a write API and never mutates SP. It is a
 * no-op unless the feature is enabled.
 */
export const runDailyNoteDryRun = async (cfg: DailyNoteCfg, now: Date = new Date()): Promise<void> => {
  if (!cfg.enabled) return;
  if (!cfg.vaultRoot) {
    log.error('Daily notes enabled but no vault root is set');
    return;
  }

  const notePath = resolveInsideVault(cfg.vaultRoot, dailyNoteRelativePath(cfg, now));

  const [tags, tasks] = await Promise.all([PluginAPI.getAllTags(), PluginAPI.getTasks()]);
  const plannedIds = new Set(plannedTaskIdsForToday(tags));
  const planned: DailyPlanTask[] = tasks
    .filter((t) => plannedIds.has(t.id))
    .map((t) => ({ id: t.id, title: t.title, isDone: t.isDone, projectId: t.projectId }));

  const content = await readTasksFile(notePath);
  if (content === null) {
    log.log(`daily note missing, not created: ${notePath}`);
    return;
  }
  const lines = content.split('\n');
  const result = planDailyNote(cfg, lines, planned);

  log.log(`daily ${cfg.dryRun ? 'dry-run' : 'sync'} ${notePath}`);
  result.logLines.forEach((line) => log.log(line));

  if (cfg.dryRun || result.missingTaskIds.length === 0) return;

  // Re-read right before writing: if the user edited the note since the plan was
  // computed, skip this write rather than overwrite their change.
  const current = await readTasksFile(notePath);
  if (current !== content) {
    log.log('daily note changed during planning, skipping write');
    return;
  }
  await writeTasksFile(notePath, result.nextLines.join('\n'));
  log.log(`daily note updated: +${result.missingTaskIds.length} task(s)`);
};
