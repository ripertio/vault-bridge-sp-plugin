import { mdToSp } from '../../sync/md-to-sp';
import { Task } from '@super-productivity/plugin-api';

/**
 * Regression test for "abort import on parse errors"
 * (super-productivity#9323 second review, point 2).
 *
 * When the Markdown file contains a line the parser cannot fully understand,
 * `parseMarkdownWithHeader` reports it in `errors` and drops the offending task
 * from the parsed set. A line like `- [ ] <!--A-->` (a known id but an empty
 * title) is such a case: the parser skips it, so the parsed set no longer
 * contains task A. Reconciliation treats the parsed set as authoritative, so
 * continuing would generate a DELETE for A — destroying a real SP task because
 * of a transient/half-typed file.
 *
 * The fix makes `mdToSp` return as soon as `parseResult.errors` is non-empty,
 * BEFORE any operation is generated or applied. These tests assert that no
 * `batchUpdateForProject` call happens on a parse error and that the SP store
 * is left untouched, while a clean file still syncs normally.
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

describe('abort import on parse errors (point 2)', () => {
  let store: Map<string, StoreTask>;
  let batchUpdateForProject: jest.Mock;
  let showSnack: jest.Mock;

  beforeEach(() => {
    store = new Map([['A', makeTask({ id: 'A', title: 'Existing task' })]]);
    batchUpdateForProject = jest.fn(async () => ({ success: true, errors: [] }));
    showSnack = jest.fn();

    (global as any).PluginAPI = {
      getTasks: jest.fn(async () => [...store.values()] as unknown as Task[]),
      getAllProjects: jest.fn(async () => [{ id: PROJECT_ID, title: 'Test' }]),
      batchUpdateForProject,
      showSnack,
    };
  });

  afterEach(() => {
    delete (global as any).PluginAPI;
  });

  it('does not touch SP when the file has a parse error (empty title)', async () => {
    // Empty title with a known id — the parser reports an error and drops it,
    // which would otherwise delete task A.
    const markdown = `- [ ] <!--A-->`;

    const result = await mdToSp(markdown, PROJECT_ID);

    // Reports the abort so callers know to skip the SP→MD write-back.
    expect(result).toBe('parse-error');
    // No operations applied at all — not even a "delete A".
    expect(batchUpdateForProject).not.toHaveBeenCalled();
    // The existing task survives untouched.
    expect(store.has('A')).toBe(true);
    // The user is warned that the import was skipped.
    expect(showSnack).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'WARNING' }),
    );
  });

  it('still syncs a clean file (no parse errors)', async () => {
    // A valid edit: task A kept, task B added.
    const markdown = `- [ ] <!--A--> Existing task\n- [ ] New task`;

    const result = await mdToSp(markdown, PROJECT_ID);

    // A clean file reports success and goes through to SP.
    expect(result).toBe('ok');
    expect(batchUpdateForProject).toHaveBeenCalled();
    expect(showSnack).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'WARNING' }),
    );
  });
});
