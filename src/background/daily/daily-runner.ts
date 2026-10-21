import { readTasksFile, writeTasksFile } from '../helper/file-utils';
import { log } from '../../shared/logger';
import {
  DailyNoteCfg,
  dailyNoteRelativePath,
  plannedTaskIdsForToday,
  resolveInsideVault,
} from './daily-note';
import { planDailyNote, DailyPlanTask } from './daily-plan';
import { DailyBaseline, diffNoteAgainstBaseline, parseNoteTaskLine } from './daily-reverse';

export interface DailyRunDeps {
  // Persist the baseline after a successful write (device-local config).
  saveBaseline: (baseline: DailyBaseline) => void;
  getBaseline: () => DailyBaseline;
}

/**
 * Daily-note sync for one run.
 *
 * Reverse (note → SP): checkbox/title edits to lines the plugin wrote are applied
 * with updateTask. Forward (SP → note): missing Today tasks are appended under
 * ## To Dos and checkboxes follow SP. Writes only happen when dryRun is false.
 * Tasks are never created or deleted from the note.
 */
export const runDailyNoteDryRun = async (
  cfg: DailyNoteCfg,
  deps: DailyRunDeps,
  now: Date = new Date(),
): Promise<void> => {
  if (!cfg.enabled) return;
  if (!cfg.vaultRoot) {
    log.error('Daily notes enabled but no vault root is set');
    return;
  }

  const notePath = resolveInsideVault(cfg.vaultRoot, dailyNoteRelativePath(cfg, now));

  const [tags, tasks] = await Promise.all([PluginAPI.getAllTags(), PluginAPI.getTasks()]);
  const plannedIds = new Set(plannedTaskIdsForToday(tags));
  const spIsDone: Record<string, boolean> = {};
  for (const t of tasks) spIsDone[t.id] = t.isDone;
  const planned: DailyPlanTask[] = tasks
    .filter((t) => plannedIds.has(t.id))
    .map((t) => ({ id: t.id, title: t.title, isDone: t.isDone, projectId: t.projectId }));

  const content = await readTasksFile(notePath);
  if (content === null) {
    log.log(`daily note missing, not created: ${notePath}`);
    return;
  }
  // An empty note is zero lines, not one blank line.
  const lines = content === '' ? [] : content.split('\n');

  // 1) Reverse: note edits → SP (only the plugin's own baseline IDs).
  const baseline = deps.getBaseline();
  const reverse = diffNoteAgainstBaseline(lines, baseline, spIsDone);
  log.log(`daily ${cfg.dryRun ? 'dry-run' : 'sync'} ${notePath}`);
  reverse.forEach((c) => log.log(`  ← note ${c.taskId} ${JSON.stringify(c.updates)}`));
  if (!cfg.dryRun) {
    for (const c of reverse) {
      await PluginAPI.updateTask(c.taskId, c.updates);
    }
  }

  // 2) Forward: SP → note.
  const result = planDailyNote(cfg, lines, planned);
  result.logLines.forEach((line) => log.log(line));

  const changes = result.missingTaskIds.length + result.statusChangedTaskIds.length;
  if (cfg.dryRun || changes === 0) return;

  // Re-read right before writing: if the user edited the note since the plan was
  // computed, skip this write rather than overwrite their change.
  const current = await readTasksFile(notePath);
  if (current !== content) {
    log.log('daily note changed during planning, skipping write');
    return;
  }
  await writeTasksFile(notePath, result.nextLines.join('\n'));
  log.log(`daily note updated: +${result.missingTaskIds.length} task(s), ~${result.statusChangedTaskIds.length} checkbox(es)`);

  // 3) Baseline = what the plugin now agrees with, for lines it owns.
  const next: DailyBaseline = { ...baseline };
  for (const line of result.nextLines) {
    const parsed = parseNoteTaskLine(line);
    if (parsed && planned.some((t) => t.id === parsed.id)) {
      const task = planned.find((t) => t.id === parsed.id)!;
      next[parsed.id] = { isDone: task.isDone, title: task.title };
    }
  }
  deps.saveBaseline(next);
};
