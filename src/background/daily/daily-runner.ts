import { assertRealPathInside, readTasksFile, writeTasksFile } from '../helper/file-utils';
import { log } from '../../shared/logger';
import {
  DailyNoteCfg,
  dailyNoteRelativePath,
  isoDay,
  plannedTaskIdsForToday,
  ScheduledTaskFields,
  resolveInsideVault,
} from './daily-note';
import { planDailyNote, DailyPlanTask, INBOX_PROJECT_ID } from './daily-plan';
import { DailyBaseline, diffNoteAgainstBaseline, findRemovedBaselineIds, parseNoteTaskLine } from './daily-reverse';
import { applyBatch } from '../sync/md-to-sp';
import { findNewTaskLines, stampNewTaskLine } from './daily-create';
import { findToDosSection } from './daily-note';
import { findOverdueIds, insertIntoSection, readPreviousNote } from './daily-rollover';

export interface DailyRunDeps {
  // Persist the baseline and the day of the note it was written for (device-local config).
  saveBaseline: (baseline: DailyBaseline, day: string) => void;
  getBaseline: () => DailyBaseline;
  // Day the stored baseline belongs to. Missing means unknown, so it is not trusted for removals.
  getBaselineDay?: () => string | undefined;
  // Day whose overdue tasks were already rolled over (once per day, device-local).
  getRolloverDay?: () => string | undefined;
  saveRolloverDay?: (day: string) => void;
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
  if (!cfg.vaultPath) {
    log.error('Daily notes enabled but no vault root is set');
    return;
  }

  const notePath = resolveInsideVault(cfg.vaultPath, dailyNoteRelativePath(cfg, now));
  // Symlinks are resolved too: a link inside the vault must not lead the note outside it.
  await assertRealPathInside(cfg.vaultPath, notePath);

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
  const today = isoDay(now);
  // The baseline lists IDs from the note of the day it was saved on. On a new day
  // those IDs are not missing from today's note, they were never in it.
  const baselineForToday = deps.getBaselineDay?.() === today ? baseline : {};
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
  const removedIds = findRemovedBaselineIds(lines, baselineForToday);
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

  // 1a2) SP delete → note: a line whose SP task is gone (deleted in the project file or in
  // SP) goes too, so both places agree. Same opt-in as 1a. Skipped when the task list is
  // empty, so a failed read cannot clear the note. Runs before creation, so new IDs are
  // not mistaken for gone ones.
  const liveIds = new Set(tasks.map((t) => t.id));
  const goneIds = new Set<string>();
  if (liveIds.size > 0) {
    for (const line of working) {
      const parsed = parseNoteTaskLine(line);
      if (parsed && !liveIds.has(parsed.id)) goneIds.add(parsed.id);
    }
  }
  let goneRemoved = 0;
  if (goneIds.size > 0) {
    log.log(`  - ${goneIds.size} note line(s) whose SP task is gone${cfg.dryRun ? ' (dry-run)' : ''}`);
    if (cfg.deleteRemoved && !cfg.dryRun) {
      goneRemoved = working.filter((l) => {
        const parsed = parseNoteTaskLine(l);
        return parsed !== null && goneIds.has(parsed.id);
      }).length;
      working = working.filter((l) => {
        const parsed = parseNoteTaskLine(l);
        return !(parsed && goneIds.has(parsed.id));
      });
    }
  }
  const section = findToDosSection(working);
  const created: string[] = [];
  const createdTasks: { id: string; title: string; isDone: boolean }[] = [];
  if (section) {
    const newTasks = findNewTaskLines(working, section.bodyStart, section.bodyEnd);
    for (const nt of newTasks) {
      log.log(`  + note → SP "${nt.title}"${cfg.dryRun ? ' (dry-run)' : ''}`);
      if (cfg.dryRun) continue;
      // Scheduled for today (SP's Today view lists tasks whose dueDay is today).
      const data: Parameters<typeof PluginAPI.addTask>[0] & ScheduledTaskFields = {
        title: nt.title,
        isDone: nt.isDone,
        dueDay: isoDay(now),
      };
      const id = await PluginAPI.addTask(data);
      working[nt.lineIndex] = stampNewTaskLine(working[nt.lineIndex], id);
      created.push(id);
      createdTasks.push({ id, title: nt.title, isDone: nt.isDone });
    }
  }

  // 1c) Rollover (opt-in, once per day): unfinished tasks from the last earlier note
  // are carried into today's ## To Dos. The lines go in before the forward plan, so
  // the plan sees them as present and does not add them twice.
  const rolloverDue = cfg.rolloverOverdue && deps.getRolloverDay?.() !== today;
  let carriedCount = 0;
  if (rolloverDue && section) {
    const previous = await readPreviousNote(cfg, now, async (p) => {
      await assertRealPathInside(cfg.vaultPath, p);
      return readTasksFile(p);
    });
    if (previous) {
      const overdueIds = findOverdueIds(previous.lines, spIsDone);
      const body = working.slice(section.bodyStart, section.bodyEnd).join('\n');
      const carried = tasks.filter((t) => overdueIds.has(t.id) && !body.includes(`<!--${t.id}-->`));
      for (const t of carried) {
        log.log(`  ↻ rollover "${t.title}" from ${isoDay(previous.day)}${cfg.dryRun ? ' (dry-run)' : ''}`);
      }
      if (!cfg.dryRun && carried.length > 0) {
        working = insertIntoSection(
          working,
          section,
          carried.map((t) => `- [ ] <!--${t.id}--> ${t.title}`),
        );
      }
      carriedCount = carried.length;
    }
  }

  // 2) Forward: SP → note. In write mode, created tasks are not yet in the Today
  // tag, so they are not planned here; they are stamped with their ID above.
  // Tasks already in ## To Dos also get their checkbox kept in step with SP, even when they
  // are not planned for today (for example a rolled-over task). They are never re-added.
  const bodyIds = section
    ? new Set(working.slice(section.bodyStart, section.bodyEnd).flatMap((l) => parseNoteTaskLine(l)?.id ?? []))
    : new Set<string>();
  const inBody = tasks
    .filter((t) => bodyIds.has(t.id) && !planned.some((p) => p.id === t.id))
    .map((t) => ({ id: t.id, title: t.title, isDone: t.isDone, projectId: t.projectId }));
  const result = planDailyNote(cfg, working, [...planned, ...inBody]);
  result.logLines.forEach((line) => log.log(line));

  const changes =
    result.missingTaskIds.length + result.statusChangedTaskIds.length + created.length + carriedCount + goneRemoved;
  if (cfg.dryRun) return;
  if (changes === 0) {
    if (rolloverDue) deps.saveRolloverDay?.(today);
    return;
  }

  // Re-read right before writing: if the user edited the note since the plan was
  // computed, skip this write rather than overwrite their change.
  const current = await readTasksFile(notePath);
  if (current !== content) {
    log.log('daily note changed during planning, skipping write');
    return;
  }
  await writeTasksFile(notePath, result.nextLines.join('\n'));
  if (rolloverDue) deps.saveRolloverDay?.(today);
  if (carriedCount > 0) log.log(`rolled over ${carriedCount} overdue task(s)`);
  if (created.length > 0) log.log(`created ${created.length} SP task(s) from the note`);
  log.log(`daily note updated: +${result.missingTaskIds.length} task(s), ~${result.statusChangedTaskIds.length} checkbox(es)`);

  // 3) Baseline = what the plugin now agrees with, for lines it owns.
  const next: DailyBaseline = { ...baselineForToday };
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
  deps.saveBaseline(next, today);
};
