import { parseMarkdown } from '../../sync/markdown-parser';
import { generateTaskOperations } from '../../sync/generate-task-operations';
import { convertTasksToMarkdown } from '../../sync/sp-to-md';
import { Task, BatchTaskCreate } from '@super-productivity/plugin-api';
import { TaskBuilder } from '../test-utils';

/**
 * Bug #49: re-pointing a binding to a NEW (empty) project loses subtasks.
 *
 * When the user deletes a project, chooses "Ignore", creates a new project and
 * re-points the existing binding to it, the `.md` still carries the deleted
 * project's `<!--taskId-->` markers. Those ids are foreign to the new project,
 * so every task is CREATED — but a subtask's parentId used to be emitted as the
 * parent's stale (foreign) id while the parent itself was created under a
 * `temp_<line>` id. The child's parentId was therefore a dangling reference and
 * SP dropped the subtask, leaving only the root tasks.
 *
 * Fix: when a subtask's parent is itself being created (not an existing SP task),
 * the create must reference the parent's create tempId, so the batch links them.
 */
describe('Re-point binding to a new project — foreign ids (Bug #49)', () => {
  const NEW_PROJECT_ID = 'new-empty-project';

  const markdown = [
    '- [ ] <!--old-parent--> Parent Alpha', // line 0
    '  - [ ] <!--old-sub-1--> Alpha Sub 1', // line 1
    '  - [ ] <!--old-sub-2--> Alpha Sub 2', // line 2
    '- [ ] <!--old-root--> Move Me', // line 3
  ].join('\n');

  it('creates every task and links subtasks to the parent tempId (no data loss)', () => {
    const parsed = parseMarkdown(markdown);
    // New project is empty.
    const operations = generateTaskOperations(parsed, [], NEW_PROJECT_ID);

    const creates = operations.filter((op) => op.type === 'create') as BatchTaskCreate[];
    // All four tasks are created (parent + 2 subtasks + 1 other root).
    expect(creates).toHaveLength(4);
    // Nothing is deleted — the subtasks must NOT vanish.
    expect(operations.filter((op) => op.type === 'delete')).toHaveLength(0);

    const parentCreate = creates.find((op) => op.data.title === 'Parent Alpha')!;
    const sub1 = creates.find((op) => op.data.title === 'Alpha Sub 1')!;
    const sub2 = creates.find((op) => op.data.title === 'Alpha Sub 2')!;
    const moveMe = creates.find((op) => op.data.title === 'Move Me')!;

    // The subtasks reference the PARENT'S create tempId, not the stale foreign id.
    expect(sub1.data.parentId).toBe(parentCreate.tempId);
    expect(sub2.data.parentId).toBe(parentCreate.tempId);
    expect(sub1.data.parentId).not.toBe('old-parent');

    // The other root task stays a root (no parent).
    expect(moveMe.data.parentId).toBeUndefined();
  });

  it('the linked parentId is a valid batch target (a tempId, not a foreign id)', () => {
    const parsed = parseMarkdown(markdown);
    const operations = generateTaskOperations(parsed, [], NEW_PROJECT_ID);
    const creates = operations.filter((op) => op.type === 'create') as BatchTaskCreate[];

    const tempIds = new Set(creates.map((op) => op.tempId));
    creates
      .filter((op) => op.data.parentId)
      .forEach((op) => {
        // Every child's parentId must resolve to a task created in this same batch.
        expect(tempIds.has(op.data.parentId as string)).toBe(true);
      });
  });

  it('round-trip is stable once SP has assigned fresh ids', () => {
    // After the batch, SP has the tasks under brand-new ids; SP→MD stamps them
    // back into the file. A subsequent MD→SP must be a no-op (besides reorder).
    const freshSpTasks: Task[] = [
      new TaskBuilder()
        .withId('fresh-parent')
        .withTitle('Parent Alpha')
        .withSubTaskIds(['fresh-sub-1', 'fresh-sub-2'])
        .build(),
      new TaskBuilder()
        .withId('fresh-sub-1')
        .withTitle('Alpha Sub 1')
        .withParentId('fresh-parent')
        .build(),
      new TaskBuilder()
        .withId('fresh-sub-2')
        .withTitle('Alpha Sub 2')
        .withParentId('fresh-parent')
        .build(),
      new TaskBuilder().withId('fresh-root').withTitle('Move Me').build(),
    ];

    const rewritten = convertTasksToMarkdown(freshSpTasks);
    const reparsed = parseMarkdown(rewritten);
    const finalOps = generateTaskOperations(reparsed, freshSpTasks, NEW_PROJECT_ID);

    const nonReorder = finalOps.filter((op) => op.type !== 'reorder');
    expect(nonReorder).toHaveLength(0);
  });
});
