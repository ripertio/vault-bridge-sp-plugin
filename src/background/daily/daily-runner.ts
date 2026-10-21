import { readTasksFile, writeTasksFile } from '../helper/file-utils';
import { log } from '../../shared/logger';
import {
  DailyNoteCfg,
  dailyNoteRelativePath,
  plannedTaskIdsForToday,
  resolveInsideVault,
} from './daily-note';
import { planDailyNote, DailyPlanTask, INBOX_PROJECT_ID } from './daily-plan';
import { DailyBaseline, diffNoteAgainstBaseline, findRemovedBaselineIds, parseNoteTaskLine } from './daily-reverse';
import { applyBatch } from '../sync/md-to-sp';
import { findNewTaskLines, stampNewTaskLine } from './daily-create';
import { findToDosSection } from './daily-note';

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

  // 1a) Delete: only when the user opted in. The same batch op the original
  // sync uses (applyBatch + a delete op), grouped per SP project.
  const removedIds = findRemovedBaselineIds(lines, baseline);
  if (removedIds.length > 0) {
    log.log(`  - ${removedIds.length} task line(s) removed from the note`);
    if (cfg.deleteRemoved && !cfg.dryRun) {
      const byProject = new Map<string, string[]>();
      for (const id of removedIds) {
        const projectId = tasks.find((t) => t.id === id)?.projectId ?? INBOX_PROJECT_ID;
        byProject.set(projectId, [...(byProject.get(projectId) ?? []), id]);
      }
      for (const [projectId, ids] of byProject) {
        await applyBatch(projectId, ids.map((taskId) => ({ type: 'delete', taskId }) as any));
      }
    }
  }

  // 1b) Create: task lines the user typed (no ID) become SP tasks in the Inbox.
  let working = [...lines];
  const section = findToDosSection(working);
  const created: string[] = [];
  const createdTasks: { id: string; title: string; isDone: boolean }[] = [];
  if (section) {
    const newTasks = findNewTaskLines(working, section.bodyStart, section.bodyEnd);
    for (const nt of newTasks) {
      log.log(`  + note → SP "${nt.title}"${cfg.dryRun ? ' (dry-run)' : ''}`);
      if (cfg.dryRun) continue;
      const id = await PluginAPI.addTask({ title: nt.title, isDone: nt.isDone });
      working[nt.lineIndex] = stampNewTaskLine(working[nt.lineIndex], id);
      created.push(id);
      createdTasks.push({ id, title: nt.title, isDone: nt.isDone });
    }
  }

  // 2) Forward: SP → note. In write mode, created tasks are not yet in the Today
  // tag, so they are not planned here; they are stamped with their ID above.
  const result = planDailyNote(cfg, working, planned);
  result.logLines.forEach((line) => log.log(line));

  const changes = result.missingTaskIds.length + result.statusChangedTaskIds.length + created.length;
  if (cfg.dryRun || changes === 0) return;

  // Re-read right before writing: if the user edited the note since the plan was
  // computed, skip this write rather than overwrite their change.
  const current = await readTasksFile(notePath);
  if (current !== content) {
    log.log('daily note changed during planning, skipping write');
    return;
  }
  await writeTasksFile(notePath, result.nextLines.join('\n'));
  if (created.length > 0) log.log(`created ${created.length} SP task(s) from the note`);
  log.log(`daily note updated: +${result.missingTaskIds.length} task(s), ~${result.statusChangedTaskIds.length} checkbox(es)`);

  // 3) Baseline = what the plugin now agrees with, for lines it owns.
  const next: DailyBaseline = { ...baseline };
  // Every ID on a note line is owned by the plugin, including tasks created from
  // the note (they live in the Inbox, so they are not in `planned`).
  const byId = new Map<string, { id: string; title: string; isDone: boolean }>(
    [...tasks, ...createdTasks].map((t) => [t.id, t]),
  );
  for (const line of result.nextLines) {
    const parsed = parseNoteTaskLine(line);
    const task = parsed && byId.get(parsed.id);
    if (parsed && task) {
      next[parsed.id] = { isDone: task.isDone, title: task.title };
    }
  }
  // A removed line is resolved once the user has answered: drop it from the
  // baseline either way, so the question is not asked again on every run.
  for (const id of removedIds) {
    if (cfg.deleteRemoved && !cfg.dryRun) delete next[id];
  }
  deps.saveBaseline(next);
};
