import { mdToSp } from '../../sync/md-to-sp';
import { Task, BatchOperation } from '@super-productivity/plugin-api';

/**
 * Regression test for the parent-delete / child-promote cascade
 * (super-productivity#9323 review, blocker 1).
 *
 * Scenario: a parent task P has a child C. The user edits the Markdown to
 * remove P and un-indent C so it becomes a root task. Syncing MD → SP must
 * delete P but KEEP C (now promoted to root).
 *
 * SP's real batch reducer resolves a `delete` against the subTaskIds the task
 * had at the *start of the batch*. If the delete of P and the re-parenting of
 * C are applied in the same batch, the reducer still reads P.subTaskIds = [C]
 * and recursively deletes C along with P — the promoted child vanishes.
 *
 * The mock `batchUpdateForProject` below reproduces that exact semantics:
 * within a single call, deletes cascade over a snapshot taken at call entry.
 * The fix in `mdToSp` issues the delete in a *second* batch, after the
 * re-parenting update has committed, so P.subTaskIds is already empty and no
 * cascade occurs.
 */

interface StoreTask {
  id: string;
  title: string;
  parentId: string | null;
  subTaskIds: string[];
  projectId: string;
}

const PROJECT_ID = 'test-project';

const makeTask = (t: Partial<StoreTask> & { id: string; title: string }): StoreTask => ({
  parentId: null,
  subTaskIds: [],
  projectId: PROJECT_ID,
  ...t,
});

describe('parent-delete / child-promote cascade (blocker 1)', () => {
  let store: Map<string, StoreTask>;

  /**
   * Faithful model of SP's cascading batch reducer. Deletes cascade over the
   * subTaskIds as they were at the START of this batch call (pre-update state),
   * which is the behaviour that made an in-batch parent delete swallow a
   * just-promoted child.
   */
  const batchUpdateForProject = jest.fn(
    async ({ operations }: { projectId: string; operations: BatchOperation[] }) => {
      const snapshot = new Map(
        [...store].map(([id, task]) => [
          id,
          { ...task, subTaskIds: [...task.subTaskIds] },
        ]),
      );

      const cascadeDelete = (id: string): void => {
        const snap = snapshot.get(id);
        if (snap) {
          snap.subTaskIds.forEach(cascadeDelete);
        }
        store.delete(id);
      };

      let tempCounter = 0;
      for (const op of operations) {
        if (op.type === 'create') {
          const newId = `created-${tempCounter++}`;
          store.set(
            newId,
            makeTask({
              id: newId,
              title: op.data.title,
              parentId: op.data.parentId ?? null,
            }),
          );
        } else if (op.type === 'update') {
          const task = store.get(op.taskId);
          if (task) {
            if (op.updates.parentId !== undefined) task.parentId = op.updates.parentId;
            if (op.updates.subTaskIds !== undefined) {
              task.subTaskIds = [...op.updates.subTaskIds];
            }
            if (op.updates.title !== undefined) task.title = op.updates.title;
          }
        } else if (op.type === 'delete') {
          cascadeDelete(op.taskId);
        }
        // reorder is irrelevant to this scenario
      }

      return { success: true, errors: [] };
    },
  );

  beforeEach(() => {
    store = new Map([
      ['P', makeTask({ id: 'P', title: 'Parent', subTaskIds: ['C'] })],
      ['C', makeTask({ id: 'C', title: 'Child', parentId: 'P' })],
    ]);
    batchUpdateForProject.mockClear();

    (global as any).PluginAPI = {
      getTasks: jest.fn(async () => [...store.values()] as unknown as Task[]),
      getAllProjects: jest.fn(async () => [{ id: PROJECT_ID, title: 'Test' }]),
      batchUpdateForProject,
      showSnack: jest.fn(),
    };
  });

  afterEach(() => {
    delete (global as any).PluginAPI;
  });

  it('keeps the promoted child when its former parent is deleted', async () => {
    // Markdown after the edit: P removed, C un-indented to root.
    const markdown = `- [ ] <!--C--> Child`;

    await mdToSp(markdown, PROJECT_ID);

    // The child must survive...
    expect(store.has('C')).toBe(true);
    expect(store.get('C')!.parentId).toBeNull();
    // ...and the parent must be gone.
    expect(store.has('P')).toBe(false);
  });

  it('issues deletes in a separate batch, after the re-parenting update', async () => {
    const markdown = `- [ ] <!--C--> Child`;

    await mdToSp(markdown, PROJECT_ID);

    // Two batches: non-delete ops first, deletes second.
    expect(batchUpdateForProject).toHaveBeenCalledTimes(2);

    const firstBatchOps: BatchOperation[] =
      batchUpdateForProject.mock.calls[0][0].operations;
    const secondBatchOps: BatchOperation[] =
      batchUpdateForProject.mock.calls[1][0].operations;

    expect(firstBatchOps.every((op) => op.type !== 'delete')).toBe(true);
    expect(secondBatchOps.length).toBeGreaterThan(0);
    expect(secondBatchOps.every((op) => op.type === 'delete')).toBe(true);
    expect(
      secondBatchOps.some((op) => op.type === 'delete' && op.taskId === 'P'),
    ).toBe(true);
  });
});
