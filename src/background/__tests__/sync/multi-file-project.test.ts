import type { Task } from '@super-productivity/plugin-api';
import { bindingsFromMatches } from '../../projects/auto-bindings';
import { parseMarkdownGroup } from '../../sync/markdown-parser';
import { generateTaskOperations } from '../../sync/generate-task-operations';
import { mergeSpIntoExistingFile } from '../../sync/sp-to-md';

const task = (id: string, title: string, extra: Partial<Task> = {}): Task =>
  ({ id, title, isDone: false, projectId: 'P', subTaskIds: [], ...extra }) as Task;

describe('bindings for a project folder with several files', () => {
  const match = { matched: [{ folder: 'Alpha', projectId: 'P' }], foldersWithoutProject: [], projectsWithoutFolder: [], ambiguous: [] };

  it('adds one binding per extra file and lists the files, task file first', () => {
    const b = bindingsFromMatches(match, '/v/Projects', {}, 'backlog.md', { Alpha: ['backlog.md', 'ideas.md', 'later.md'] });
    expect(b.map((x) => x.id)).toEqual(['auto-P', 'auto-P::ideas.md', 'auto-P::later.md']);
    const groupPaths = ['/v/Projects/Alpha/backlog.md', '/v/Projects/Alpha/ideas.md', '/v/Projects/Alpha/later.md'];
    b.forEach((x) => expect(x.groupPaths).toEqual(groupPaths));
    expect(b[1].filePath).toBe(groupPaths[1]);
  });

  it('includes files in subfolders, and a nested file named like the task file', () => {
    const b = bindingsFromMatches(match, '/v/Projects', {}, 'backlog.md', { Alpha: ['backlog.md', 'sub/backlog.md', 'sub/deep/x.md'] });
    expect(b.map((x) => x.filePath)).toEqual([
      '/v/Projects/Alpha/backlog.md',
      '/v/Projects/Alpha/sub/backlog.md',
      '/v/Projects/Alpha/sub/deep/x.md',
    ]);
  });

  it('keeps a single plain binding when the folder has only the task file', () => {
    const b = bindingsFromMatches(match, '/v/Projects', {}, 'backlog.md', { Alpha: ['backlog.md'] });
    expect(b).toHaveLength(1);
    expect(b[0].groupPaths).toBeUndefined();
  });
});

describe('importing several files as one task list', () => {
  it('does not delete a task whose line is in another file', () => {
    const parsed = parseMarkdownGroup(['- [ ] <!--a--> A\n', '- [ ] <!--b--> B\n']).tasks;
    const ops = generateTaskOperations(parsed, [task('a', 'A'), task('b', 'B')], 'P');
    expect(ops.filter((o) => o.type === 'delete')).toEqual([]);
  });

  it('deletes a task whose line is in no file', () => {
    const parsed = parseMarkdownGroup(['- [ ] <!--a--> A\n', '']).tasks;
    const ops = generateTaskOperations(parsed, [task('a', 'A'), task('b', 'B')], 'P');
    expect(ops.filter((o) => o.type === 'delete')).toEqual([{ type: 'delete', taskId: 'b' }]);
  });

  it('keeps temp ids of new lines in different files apart', () => {
    const parsed = parseMarkdownGroup(['- [ ] one\n', '- [ ] two\n']).tasks;
    const creates = generateTaskOperations(parsed, [], 'P').filter((o) => o.type === 'create') as { tempId: string }[];
    expect(new Set(creates.map((c) => c.tempId)).size).toBe(2);
  });
});

describe('writing SP back to a file of a multi-file project', () => {
  const tasks = [task('a', 'A'), task('b', 'B'), task('n', 'New')];
  const map = new Map(tasks.map((t) => [t.id, t]));

  it('main file appends new tasks but not the ones another file holds', () => {
    const out = mergeSpIntoExistingFile('- [ ] <!--a--> A', map, tasks, { otherFileIds: new Set(['b']), appendNew: true });
    expect(out).toBe('- [ ] <!--a--> A\n- [ ] <!--n--> New');
  });

  it('extra file never receives new tasks', () => {
    const out = mergeSpIntoExistingFile('- [ ] <!--b--> B', map, tasks, { otherFileIds: new Set(['a']), appendNew: false });
    expect(out).toBe('- [ ] <!--b--> B');
  });

  it('extra file still follows SP for its own lines', () => {
    const done = new Map([['b', task('b', 'B2', { isDone: true })]]);
    const out = mergeSpIntoExistingFile('- [ ] <!--b--> B', done, [...done.values()], { otherFileIds: new Set(), appendNew: false });
    expect(out).toContain('- [x] <!--b--> B2');
  });

  it('main file leaves out a task created from a no-ID line of another file', () => {
    const out = mergeSpIntoExistingFile('- [ ] <!--a--> A', map, tasks, {
      otherFileIds: new Set(),
      otherFileTitles: ['New'],
      appendNew: true,
    });
    expect(out).not.toContain('New');
  });

  it('extra file stamps its no-ID line with the matching SP task, not one held elsewhere', () => {
    const t = [task('x', 'Same'), task('y', 'Same')];
    const out = mergeSpIntoExistingFile('- [ ] Same', new Map(t.map((k) => [k.id, k])), t, {
      otherFileIds: new Set(['x']),
      appendNew: false,
    });
    expect(out).toContain('<!--y-->');
  });
});
