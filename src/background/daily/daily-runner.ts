import { readTasksFile } from '../helper/file-utils';
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
  const lines = content === null ? [] : content.split('\n');
  const result = planDailyNote(cfg, lines, planned);

  log.log(`daily dry-run ${notePath} (note ${content === null ? 'missing' : 'found'})`);
  result.logLines.forEach((line) => log.log(line));
};
