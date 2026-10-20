import type { Task } from '@super-productivity/plugin-api';
import { writeTasksFile, readTasksFile } from '../helper/file-utils';
import { stripStatusTags } from './markdown-parser';
import { SyncBindingCfg } from '../local-config';

/** Regex that matches a markdown task checkbox line (with optional leading indent). */
const TASK_LINE_REGEX = /^(\s*)- \[([ x])\]\s*(?:<!--([^>]+)-->\s*)?(.*)$/;
/** Regex for markdown section headers (## Title, ### Title, …). */
const SECTION_HEADER_REGEX = /^#{1,6}\s/;

/** Two-digit zero-pad. */
const pad2 = (n: number): string => String(n).padStart(2, '0');

/**
 * The `@done(...)` suffix for a task line, from SP state:
 *  - not done           → `''` (active tasks stay tag-less)
 *  - done + `doneOn`    → ` @done(YYYY-MM-DD HH:mm)` (local, 24h)
 *  - done, no `doneOn`  → ` @done` (bare, no date)
 */
export const formatDoneTag = (task: Task): string => {
  if (!task.isDone) return '';
  if (task.doneOn == null) return ' @done';
  const d = new Date(task.doneOn);
  return ` @done(${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())})`;
};

/**
 * Extract an existing trailing `@done[(date[ time])]` from a raw task title,
 * normalised with a leading space (`' @done(...)'` / `' @done'`), or `''` if
 * none. Used to PRESERVE a date the user (or an imported file) already wrote —
 * SP doesn't store it (`doneOn` may be null after an import), so we keep the
 * file's own date instead of regenerating/losing it.
 */
export const extractDoneTag = (rawTitle: string): string => {
  const m = rawTitle.match(/@done(\([^)]*\))?\s*$/i);
  if (!m) return '';
  return m[1] ? ` @done${m[1]}` : ' @done';
};

/**
 * The single place that renders a markdown task line from SP state:
 * `<indent>- [ /x] <!--id--> title[ @done(...)]`. Used by every write path
 * (initial create + all in-place-merge rebuild sites) so the format stays
 * consistent. `indentStr` is the leading whitespace, used verbatim.
 *
 * `existingDoneTag` (from the line being replaced) is preserved when the task is
 * still done, so a date already in the file survives round-trips; a task newly
 * completed in SP (no existing tag) gets `@done` derived from `doneOn`.
 */
export const buildTaskLine = (
  indentStr: string,
  task: Task,
  existingDoneTag = '',
): string => {
  const checkbox = task.isDone ? '[x]' : '[ ]';
  const idPart = task.id ? `<!--${task.id}--> ` : '';
  const doneTag = task.isDone ? existingDoneTag || formatDoneTag(task) : '';
  return `${indentStr}- ${checkbox} ${idPart}${task.title}${doneTag}`;
};

/**
 * Replicate Super Productivity tasks to markdown file.
 *
 * When the file already exists the function performs an **in-place merge**:
 * only task checkbox lines are updated; every other line (section headers,
 * blank lines, notes, any non-task markdown) is preserved exactly as-is.
 *
 * When the file does not yet exist it generates the content from scratch using
 * the same `convertTasksToMarkdown` helper that was used before.
 */
export const spToMd = async (config: SyncBindingCfg): Promise<void> => {
  // Note: writeTasksFile already creates the directory if it doesn't exist.
  const allTasks = await PluginAPI.getTasks();
  const projects = await PluginAPI.getAllProjects();
  const project = projects.find((p) => p.id === config.projectId);

  // Filter tasks for this project
  const projectTasks = allTasks.filter((task) => task.projectId === config.projectId);

  // If project has taskIds, use them to order the parent tasks
  let orderedTasks = projectTasks;
  if (project && project.taskIds && project.taskIds.length > 0) {
    const taskMap = new Map<string, Task>();
    projectTasks.forEach((task) => {
      taskMap.set(task.id, task);
    });

    const orderedParentTasks: Task[] = [];
    project.taskIds.forEach((taskId) => {
      const task = taskMap.get(taskId);
      if (task && !task.parentId) {
        orderedParentTasks.push(task);
      }
    });

    const subtasks = projectTasks.filter((task) => task.parentId);
    orderedTasks = [...orderedParentTasks, ...subtasks];
  }

  // Build a fast lookup map: taskId → Task
  const spTaskMap = new Map<string, Task>();
  projectTasks.forEach((task) => {
    if (task.id) spTaskMap.set(task.id, task);
  });

  // Read existing file
  const existingContent = await readTasksFile(config.filePath);

  if (existingContent) {
    // In-place merge: update task lines, leave everything else untouched
    const finalContent = mergeSpIntoExistingFile(existingContent, spTaskMap, orderedTasks);
    await writeTasksFile(config.filePath, finalContent);
  } else {
    // File doesn't exist yet: generate from scratch
    const markdown = convertTasksToMarkdown(orderedTasks);
    await writeTasksFile(config.filePath, markdown);
  }
};

/**
 * Detect the indentation unit (the actual leading-whitespace STRING for one
 * level) used by task lines in the file — e.g. a single tab `"\t"` or two
 * spaces `"  "`. Returning the real string (not a character count) is important
 * because the file may indent with tabs; reusing `"\t"` keeps new subtasks
 * consistent with the existing ones instead of collapsing a tab to one space.
 *
 * Heuristic: the shortest non-empty leading whitespace among indented task lines
 * corresponds to one nesting level. Defaults to two spaces when there are no
 * indented tasks (matching `convertTasksToMarkdown`).
 */
const detectIndentString = (lines: string[]): string => {
  let unit: string | null = null;
  for (const line of lines) {
    const m = line.match(/^([ \t]+)- \[/);
    if (m && (unit === null || m[1].length < unit.length)) {
      unit = m[1];
    }
  }
  return unit ?? '    ';
};

/**
 * Insert newly created SP subtasks into an existing file, indented and placed
 * directly under their (already-present) parent task, after the parent's
 * existing subtask block. Mutates `outputLines` in place.
 *
 * Without this, a new subtask of a parent that is already in the file would be
 * rendered by `convertTasksToMarkdown` as a flat, unindented "orphan" appended
 * at the end of the file — and, being indented but detached, could be re-parsed
 * as a subtask of an unrelated task (issue #12).
 */
const insertNewSubtasksUnderParents = (
  outputLines: string[],
  subtasks: Task[],
  spTaskMap: Map<string, Task>,
  indentUnit: string,
  preservedDoneTags: Map<string, string> = new Map(),
): void => {
  const byParent = new Map<string, Task[]>();
  subtasks.forEach((st) => {
    if (!st.parentId) return;
    if (!byParent.has(st.parentId)) byParent.set(st.parentId, []);
    byParent.get(st.parentId)!.push(st);
  });

  const insertions: Array<{ index: number; lines: string[] }> = [];

  byParent.forEach((subs, parentId) => {
    // Locate the parent line by its id marker (guaranteed present: the parent
    // is in `seenTaskIds`, so a `<!--id-->` line for it was emitted).
    const pIdx = outputLines.findIndex((l) => l.includes(`<!--${parentId}-->`));
    if (pIdx === -1) return;

    const parentIndent = outputLines[pIdx].match(/^(\s*)/)![1];

    // Walk past the parent's existing subtree (deeper task lines and their note
    // lines); stop at the first sibling/parent-level task, section header, or blank.
    // New subtasks are appended at the end of the group here; the final position
    // within the group is fixed afterwards by `reorderSubtaskGroups` (which sorts
    // every parent's children to match SP's `subTaskIds`).
    let insertAt = pIdx + 1;
    while (insertAt < outputLines.length) {
      const l = outputLines[insertAt];
      const tm = l.match(TASK_LINE_REGEX);
      if (tm) {
        if (tm[1].length > parentIndent.length) {
          insertAt++;
          continue;
        }
        break;
      }
      if (SECTION_HEADER_REGEX.test(l) || l.trim() === '') break;
      insertAt++;
    }

    // Reuse the file's actual indent string (tab or spaces) so new subtasks
    // match the existing ones exactly. Notes go one level deeper, and a
    // relocated task's preserved @done date (Bug #47) is reused when present.
    const childIndent = parentIndent + indentUnit;
    const noteIndent = childIndent + indentUnit;
    const newLines: string[] = [];
    subs.forEach((st) => {
      newLines.push(buildTaskLine(childIndent, st, preservedDoneTags.get(st.id!) ?? ''));
      if (st.notes && st.notes.trim()) {
        st.notes.split('\n').forEach((noteLine) => {
          if (noteLine.trim()) newLines.push(`${noteIndent}${noteLine}`);
        });
      }
    });
    insertions.push({ index: insertAt, lines: newLines });
  });

  // Apply from the bottom up so earlier indices remain valid.
  insertions.sort((a, b) => b.index - a.index);
  insertions.forEach((ins) => outputLines.splice(ins.index, 0, ...ins.lines));
};

/**
 * Reorder each parent's direct child task blocks to match SP's `subTaskIds`
 * order. A "child block" is a subtask line plus its own trailing note lines.
 *
 * This is what makes a subtask REORDER in SP (drag within the group — the
 * `[Task] Move sub task` action) reach the `.md`: the in-place merge re-emits
 * existing task lines in the FILE's order, so without this pass a pure reorder
 * (parentId unchanged) would produce a byte-identical file and get reverted on
 * the next MD→SP read-back. It also finalises the position of a relocated or
 * newly-added subtask (those are appended at the end of the group by
 * `insertNewSubtasksUnderParents`, then sorted into place here).
 *
 * Scope is deliberately limited to CHILDREN within a parent group; root-level
 * task order is left as-is (a promoted task lands at the end of the file — a
 * documented, converging limitation). Only contiguous groups are reordered; a
 * parent's own notes stay attached to the parent, ahead of its children.
 */
const reorderSubtaskGroups = (
  lines: string[],
  spTaskMap: Map<string, Task>,
): string[] => {
  const result: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const tm = line.match(TASK_LINE_REGEX);
    if (!tm) {
      result.push(line);
      i++;
      continue;
    }

    const parentIndentLen = tm[1].length;
    const parentId = tm[3];
    result.push(line); // the parent task line itself
    i++;

    // The parent's OWN note lines: non-task lines immediately after it, before
    // the first child. They stay attached to the parent, ahead of the children.
    const parentNotes: string[] = [];
    while (i < lines.length) {
      const l = lines[i];
      if (l.match(TASK_LINE_REGEX)) break;
      if (SECTION_HEADER_REGEX.test(l) || l.trim() === '') break;
      parentNotes.push(l);
      i++;
    }

    // The parent's direct child blocks (deeper task line + its trailing notes).
    const childBlocks: Array<{ id: string | undefined; lines: string[] }> = [];
    while (i < lines.length) {
      const l = lines[i];
      const ctm = l.match(TASK_LINE_REGEX);
      if (!ctm) break; // boundary (blank / section header / stray note)
      if (ctm[1].length <= parentIndentLen) break; // sibling or shallower → done

      const childIndentLen = ctm[1].length;
      const block = [l];
      i++;
      while (i < lines.length) {
        const nl = lines[i];
        const ntm = nl.match(TASK_LINE_REGEX);
        if (ntm) {
          if (ntm[1].length > childIndentLen) {
            block.push(nl); // deeper descendant (SP is single-level; general anyway)
            i++;
            continue;
          }
          break; // next sibling child or shallower
        }
        if (SECTION_HEADER_REGEX.test(nl) || nl.trim() === '') break;
        block.push(nl); // this child's own note line
        i++;
      }
      childBlocks.push({ id: ctm[3], lines: block });
    }

    result.push(...parentNotes);

    const order = (parentId && spTaskMap.get(parentId)?.subTaskIds) || [];
    if (childBlocks.length > 1 && order.length) {
      const orderIndex = new Map(order.map((id, idx) => [id, idx]));
      // Stable sort by SP order; children not in subTaskIds keep their relative
      // order at the end.
      childBlocks
        .map((b, idx) => ({
          b,
          idx,
          o: b.id !== undefined ? orderIndex.get(b.id) ?? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER,
        }))
        .sort((a, z) => a.o - z.o || a.idx - z.idx)
        .forEach(({ b }) => result.push(...b.lines));
    } else {
      childBlocks.forEach((b) => result.push(...b.lines));
    }
  }

  return result;
};

/**
 * Merge the current SP task state into an existing markdown file.
 *
 * Rules:
 * - Task lines whose `<!--id-->` is found in `spTaskMap` → updated in-place
 *   (checkbox state and title refreshed; indent preserved).
 * - Task lines whose `<!--id-->` is NOT in `spTaskMap` (task deleted in SP) →
 *   removed, along with any immediately-following note lines.
 * - Task lines with no `<!--id-->` → kept as-is (will receive an ID on the
 *   next mdToSp sync).
 * - All other lines (section headers, blank lines, notes, free-form markdown) →
 *   kept exactly as-is.
 * - SP tasks not found anywhere in the file (new tasks added in SP) → appended
 *   at the end.
 */
export const mergeSpIntoExistingFile = (
  existingContent: string,
  spTaskMap: Map<string, Task>,
  orderedTasks: Task[],
): string => {
  const lines = existingContent.split('\n');
  const outputLines: string[] = [];
  const seenTaskIds = new Set<string>();

  // Bug #47: when a task's parentId changes in SP (subtask↔parent, either
  // direction, via menu or GUI drag-and-drop) the file's placement no longer
  // matches. `preservedDoneTags` carries a relocated task's existing @done date
  // to its re-emission; `taskStack` derives each line's parent as the FILE
  // places it — the nearest preceding task with a strictly smaller indent (null
  // at root). SP is single-level so it's bounded, but the stack is general.
  const preservedDoneTags = new Map<string, string>();
  const taskStack: Array<{ indent: number; id: string | null }> = [];

  // Build a title → Task[] lookup for matching no-ID task lines by title.
  // Used to stamp IDs onto manually written lines during the initial sync.
  const spTasksByTitle = new Map<string, Task[]>();
  spTaskMap.forEach((task) => {
    if (!spTasksByTitle.has(task.title)) {
      spTasksByTitle.set(task.title, []);
    }
    spTasksByTitle.get(task.title)!.push(task);
  });

  // When we remove a task (deleted in SP, or relocated because its parent
  // changed — Bug #47) we also skip its trailing note lines.
  // A note line is any non-task, non-blank, non-section-header line that
  // immediately follows a task.  We stop skipping on blank lines, section
  // headers, or the next task line.
  let skipNotesOfRemovedTask = false;

  for (const line of lines) {
    const taskMatch = line.match(TASK_LINE_REGEX);
    const isSectionHeader = SECTION_HEADER_REGEX.test(line);
    const isBlank = line.trim() === '';

    if (taskMatch) {
      // Any task line resets the "skip notes" state
      skipNotesOfRemovedTask = false;

      const indent = taskMatch[1]; // leading whitespace preserved
      const indentLen = indent.length;
      const taskId = taskMatch[3]; // may be undefined if no <!--id-->

      // The parent as the FILE places this line: the nearest preceding task with
      // a strictly smaller indent (null = root). Pop deeper/sibling entries first.
      while (taskStack.length && taskStack[taskStack.length - 1].indent >= indentLen) {
        taskStack.pop();
      }
      const fileParentId = taskStack.length ? taskStack[taskStack.length - 1].id : null;

      // The id we resolve for this line (used to track it in the indent stack so
      // its children can find it as their parent).
      let resolvedId: string | null = taskId ?? null;

      if (taskId && spTaskMap.has(taskId)) {
        const spTask = spTaskMap.get(taskId)!;
        const spParentId = spTask.parentId ?? null;
        if (spParentId !== fileParentId) {
          // Bug #47: the task's parent changed in SP vs. where the file places it
          // (promotion → root; demotion / re-parent → under another task). Do NOT
          // emit here and do NOT mark it seen — it drops into the post-loop
          // new-task distribution, which relocates it under the new parent
          // (`insertNewSubtasksUnderParents`) or at root (`convertTasksToMarkdown`).
          // Preserve its @done date for the re-emission and skip its trailing note
          // lines here (they are regenerated from SP state at the new location).
          const done = extractDoneTag(taskMatch[4]);
          if (done) preservedDoneTags.set(taskId, done);
          skipNotesOfRemovedTask = true;
        } else {
          // Parent unchanged → update checkbox and title in place, keep indent.
          seenTaskIds.add(taskId);
          outputLines.push(buildTaskLine(indent, spTask, extractDoneTag(taskMatch[4])));
        }
      } else if (taskId && !spTaskMap.has(taskId)) {
        // Task was deleted in SP → remove line; also skip its notes
        skipNotesOfRemovedTask = true;
      } else {
        // No <!--id--> → try to match by title to stamp the ID.
        // This handles the initial sync where mdToSp created SP tasks from
        // no-ID lines: we find the corresponding SP task by title and update
        // the line in-place instead of leaving it blank and appending a duplicate.
        // Strip any trailing @done/@todo/@doing so a no-ID line like
        // "- [x] Task @done(...)" matches its clean SP title ("Task"); otherwise
        // it never matches and a duplicate is appended with an ID (bug).
        const lineTitle = stripStatusTags(taskMatch[4]).trim();
        const isSubtaskLine = indent.length > 0;
        const candidates = spTasksByTitle.get(lineTitle) || [];

        // Prefer a candidate whose parent/subtask context matches the indent level;
        // fall back to any unseen candidate.
        const match =
          candidates.find((t) => t.id && !seenTaskIds.has(t.id) && (isSubtaskLine ? !!t.parentId : !t.parentId)) ||
          candidates.find((t) => t.id && !seenTaskIds.has(t.id));

        if (match) {
          seenTaskIds.add(match.id!);
          resolvedId = match.id!;
          outputLines.push(buildTaskLine(indent, match, extractDoneTag(taskMatch[4])));
        } else {
          // No SP task matches this title → keep line unchanged
          outputLines.push(line);
        }
      }

      // Track this line so subsequent deeper lines can resolve it as their parent.
      taskStack.push({ indent: indentLen, id: resolvedId });
    } else if (skipNotesOfRemovedTask && !isBlank && !isSectionHeader) {
      // Note line belonging to a removed (deleted or relocated) task → skip it
    } else {
      // All other lines: blank lines, section headers, notes of kept tasks,
      // free-form markdown → preserve exactly
      outputLines.push(line);
      // Structural markers end the "skip notes" window
      if (isSectionHeader || isBlank) {
        skipNotesOfRemovedTask = false;
      }
    }
  }

  // Distribute SP tasks that were not found anywhere in the file (new tasks).
  const newTasks = orderedTasks.filter((task) => task.id && !seenTaskIds.has(task.id));

  // New subtasks whose parent is ALREADY in the file are inserted indented,
  // under that parent (issue #12). Everything else (new root tasks, plus new
  // subtasks whose parent is also new) is appended at the end, where
  // convertTasksToMarkdown nests them correctly.
  const subtasksUnderExistingParent = newTasks.filter(
    (task) => task.parentId && seenTaskIds.has(task.parentId),
  );
  const otherNewTasks = newTasks.filter(
    (task) => !(task.parentId && seenTaskIds.has(task.parentId)),
  );

  if (subtasksUnderExistingParent.length > 0) {
    insertNewSubtasksUnderParents(
      outputLines,
      subtasksUnderExistingParent,
      spTaskMap,
      detectIndentString(lines),
      preservedDoneTags,
    );
  }

  if (otherNewTasks.length > 0) {
    const newTasksMarkdown = convertTasksToMarkdown(otherNewTasks, preservedDoneTags);
    if (newTasksMarkdown) {
      // Blank separator ONLY when the last line is a note / section header /
      // free-form text, NOT when it is already a task line (avoids a spurious
      // blank splitting the list between consecutive tasks). An already-blank
      // last line never gets an extra blank.
      const lastLine = outputLines[outputLines.length - 1];
      const lastIsTask = lastLine !== undefined && TASK_LINE_REGEX.test(lastLine);
      if (lastLine !== undefined && lastLine.trim() !== '' && !lastIsTask) {
        outputLines.push('');
      }
      outputLines.push(...newTasksMarkdown.split('\n'));
    }
  }

  // Reorder each parent's children to match SP's subTaskIds: reflects a subtask
  // REORDER (`[Task] Move sub task`) in the file and finalises the position of any
  // relocated/newly-added subtask appended above. Root-level order is untouched.
  const orderedOutput = reorderSubtaskGroups(outputLines, spTaskMap);

  return orderedOutput.join('\n');
};

/**
 * Convert SP tasks to markdown format with proper hierarchy.
 * Used for the "generate from scratch" path (file doesn't exist yet) and for
 * rendering newly added tasks that need to be appended to an existing file.
 */
export const convertTasksToMarkdown = (
  tasks: Task[],
  preservedDoneTags?: Map<string, string>,
): string => {
  const lines: string[] = [];

  // Render a task line, reusing a relocated task's preserved @done date when one
  // was captured (Bug #47); otherwise buildTaskLine derives it from `doneOn`.
  const renderLine = (task: Task, indentSpaces: number): string =>
    buildTaskLine(' '.repeat(indentSpaces), task, preservedDoneTags?.get(task.id!) ?? '');

  // Separate parent tasks and subtasks
  const parentTasks = tasks.filter((task) => !task.parentId);
  const subtasksByParent = new Map<string, Task[]>();

  tasks
    .filter((task) => task.parentId)
    .forEach((subtask) => {
      if (!subtasksByParent.has(subtask.parentId!)) {
        subtasksByParent.set(subtask.parentId!, []);
      }
      subtasksByParent.get(subtask.parentId!)!.push(subtask);
    });

  // Process parent tasks and their subtasks
  for (const parentTask of parentTasks) {
    lines.push(renderLine(parentTask, 0));

    if (parentTask.subTaskIds && parentTask.subTaskIds.length > 0) {
      const subtasksMap = new Map<string, Task>();
      const subtasks = subtasksByParent.get(parentTask.id!) || [];
      subtasks.forEach((subtask) => {
        subtasksMap.set(subtask.id!, subtask);
      });

      for (const subTaskId of parentTask.subTaskIds) {
        const subtask = subtasksMap.get(subTaskId);
        if (subtask) {
          lines.push(renderLine(subtask, 2)); // 2 spaces indent

          if (subtask.notes && subtask.notes.trim()) {
            const noteLines = subtask.notes.split('\n');
            for (const noteLine of noteLines) {
              if (noteLine.trim()) {
                lines.push(`    ${noteLine}`); // 4 spaces indent for subtask notes
              }
            }
          }
        }
      }
    } else {
      // Fallback: no subTaskIds order available
      const subtasks = subtasksByParent.get(parentTask.id!) || [];
      for (const subtask of subtasks) {
        lines.push(renderLine(subtask, 2));

        if (subtask.notes && subtask.notes.trim()) {
          const noteLines = subtask.notes.split('\n');
          for (const noteLine of noteLines) {
            if (noteLine.trim()) {
              lines.push(`    ${noteLine}`);
            }
          }
        }
      }
    }

    // Parent task notes appear after subtasks
    if (parentTask.notes && parentTask.notes.trim()) {
      const noteLines = parentTask.notes.split('\n');
      for (const noteLine of noteLines) {
        if (noteLine.trim()) {
          lines.push(`  ${noteLine}`); // 2 spaces indent for parent notes
        }
      }
    }
  }

  // Process orphaned subtasks (subtasks whose parent is not in the current task list)
  const allSubtasks = tasks.filter((task) => task.parentId);
  const parentIds = new Set(parentTasks.map((t) => t.id));
  const orphanedSubtasks = allSubtasks.filter(
    (subtask) => subtask.parentId && !parentIds.has(subtask.parentId),
  );

  for (const orphan of orphanedSubtasks) {
    lines.push(renderLine(orphan, 0)); // No indentation for orphaned subtasks
  }

  return lines.join('\n').trim();
};

/**
 * Format a single task as a markdown checkbox line.
 */
export const formatTask = (task: Task, indent: number = 0): string =>
  buildTaskLine(' '.repeat(indent), task);
