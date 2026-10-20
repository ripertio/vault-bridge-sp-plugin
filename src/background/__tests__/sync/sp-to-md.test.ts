import { spToMd, mergeSpIntoExistingFile } from '../../sync/sp-to-md';
import { SyncBindingCfg } from '../../local-config';
import * as fileUtils from '../../helper/file-utils';
import { Task } from '@super-productivity/plugin-api';

// Mock dependencies
jest.mock('../../helper/file-utils');
jest.mock('../../../shared/logger', () => ({
  log: {
    critical: jest.fn(),
    err: jest.fn(),
    error: jest.fn(),
    log: jest.fn(),
    normal: jest.fn(),
    info: jest.fn(),
    verbose: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
  },
}));

// Mock PluginAPI
(global as any).PluginAPI = {
  getTasks: jest.fn(),
  getAllProjects: jest.fn(),
  log: {
    critical: jest.fn(),
    err: jest.fn(),
    error: jest.fn(),
    log: jest.fn(),
    normal: jest.fn(),
    info: jest.fn(),
    verbose: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
  },
  persistDataSynced: jest.fn(),
  loadSyncedData: jest.fn(),
} as any;

describe('spToMd', () => {
  const mockConfig: SyncBindingCfg = {
    id: 'test-binding',
    filePath: '/test/tasks.md',
    projectId: 'test-project',
    enabled: true,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(fileUtils, 'ensureDirectoryExists').mockResolvedValue();
    jest.spyOn(fileUtils, 'writeTasksFile').mockResolvedValue();
  });

  it('should order tasks according to project taskIds', async () => {
    const mockTasks: Task[] = [
      {
        id: 'task1',
        title: 'Task 1',
        isDone: false,
        projectId: 'test-project',
        parentId: null,
      } as Task,
      {
        id: 'task2',
        title: 'Task 2',
        isDone: false,
        projectId: 'test-project',
        parentId: null,
      } as Task,
      {
        id: 'task3',
        title: 'Task 3',
        isDone: false,
        projectId: 'test-project',
        parentId: null,
      } as Task,
      {
        id: 'other-task',
        title: 'Other Project Task',
        isDone: false,
        projectId: 'other-project',
        parentId: null,
      } as Task,
    ];

    const mockProjects = [
      {
        id: 'test-project',
        title: 'Test Project',
        // Tasks should be ordered: task3, task1, task2
        taskIds: ['task3', 'task1', 'task2'],
      },
    ];

    ((global as any).PluginAPI.getTasks as jest.Mock).mockResolvedValue(mockTasks);
    ((global as any).PluginAPI.getAllProjects as jest.Mock).mockResolvedValue(
      mockProjects,
    );

    await spToMd(mockConfig);

    // Verify the markdown was written with tasks in the correct order
    expect(fileUtils.writeTasksFile).toHaveBeenCalledWith(
      mockConfig.filePath,
      expect.stringContaining('Task 3'),
    );

    const writtenMarkdown = (fileUtils.writeTasksFile as jest.Mock).mock.calls[0][1];
    const lines = writtenMarkdown.split('\n');

    // Find the indices of each task
    const task1Index = lines.findIndex((line: string) => line.includes('Task 1'));
    const task2Index = lines.findIndex((line: string) => line.includes('Task 2'));
    const task3Index = lines.findIndex((line: string) => line.includes('Task 3'));

    // Verify the order matches project.taskIds: task3, task1, task2
    expect(task3Index).toBeLessThan(task1Index);
    expect(task1Index).toBeLessThan(task2Index);
  });

  it('should handle subtasks correctly when ordering by taskIds', async () => {
    const mockTasks: Task[] = [
      {
        id: 'parent1',
        title: 'Parent 1',
        isDone: false,
        projectId: 'test-project',
        parentId: null,
      } as Task,
      {
        id: 'parent2',
        title: 'Parent 2',
        isDone: false,
        projectId: 'test-project',
        parentId: null,
      } as Task,
      {
        id: 'child1',
        title: 'Child 1',
        isDone: false,
        projectId: 'test-project',
        parentId: 'parent1',
      } as Task,
      {
        id: 'child2',
        title: 'Child 2',
        isDone: false,
        projectId: 'test-project',
        parentId: 'parent2',
      } as Task,
    ];

    const mockProjects = [
      {
        id: 'test-project',
        title: 'Test Project',
        // Parent tasks should be ordered: parent2, parent1
        taskIds: ['parent2', 'parent1', 'child1', 'child2'], // Note: subtask IDs are included but should be ignored for parent ordering
      },
    ];

    ((global as any).PluginAPI.getTasks as jest.Mock).mockResolvedValue(mockTasks);
    ((global as any).PluginAPI.getAllProjects as jest.Mock).mockResolvedValue(
      mockProjects,
    );

    await spToMd(mockConfig);

    const writtenMarkdown = (fileUtils.writeTasksFile as jest.Mock).mock.calls[0][1];
    const lines = writtenMarkdown.split('\n');

    // Find parent tasks
    const parent1Index = lines.findIndex(
      (line: string) => line.includes('Parent 1') && !line.startsWith('  '),
    );
    const parent2Index = lines.findIndex(
      (line: string) => line.includes('Parent 2') && !line.startsWith('  '),
    );

    // Verify parent order matches project.taskIds
    expect(parent2Index).toBeLessThan(parent1Index);

    // Verify children are still under their parents
    const child1Index = lines.findIndex((line: string) => line.includes('Child 1'));
    const child2Index = lines.findIndex((line: string) => line.includes('Child 2'));

    expect(child1Index).toBeGreaterThan(parent1Index);
    expect(child2Index).toBeGreaterThan(parent2Index);
    expect(child2Index).toBeLessThan(parent1Index); // Child 2 should come before Parent 1
  });

  it('should fallback to unordered tasks when project has no taskIds', async () => {
    const mockTasks: Task[] = [
      {
        id: 'task1',
        title: 'Task 1',
        isDone: false,
        projectId: 'test-project',
        parentId: null,
      } as Task,
      {
        id: 'task2',
        title: 'Task 2',
        isDone: false,
        projectId: 'test-project',
        parentId: null,
      } as Task,
    ];

    const mockProjects = [
      {
        id: 'test-project',
        title: 'Test Project',
        // No taskIds property
      },
    ];

    ((global as any).PluginAPI.getTasks as jest.Mock).mockResolvedValue(mockTasks);
    ((global as any).PluginAPI.getAllProjects as jest.Mock).mockResolvedValue(
      mockProjects,
    );

    await spToMd(mockConfig);

    // Should still write tasks (in whatever order they came from getTasks)
    expect(fileUtils.writeTasksFile).toHaveBeenCalledWith(
      mockConfig.filePath,
      expect.stringContaining('Task 1'),
    );
    expect(fileUtils.writeTasksFile).toHaveBeenCalledWith(
      mockConfig.filePath,
      expect.stringContaining('Task 2'),
    );
  });

  it('should use in-place merge when file already exists', async () => {
    const existingContent = [
      '## My Project Tasks',
      '',
      '- [ ] <!--task1--> Task 1',
      '  A note for task 1',
      '',
      '## Done',
      '',
      '- [x] <!--task2--> Task 2',
    ].join('\n');

    const mockTasks: Task[] = [
      {
        id: 'task1',
        title: 'Task 1 (renamed)',
        isDone: true,
        projectId: 'test-project',
        parentId: null,
      } as Task,
      {
        id: 'task2',
        title: 'Task 2',
        isDone: true,
        projectId: 'test-project',
        parentId: null,
      } as Task,
    ];

    const mockProjects = [{ id: 'test-project', title: 'Test Project', taskIds: ['task1', 'task2'] }];

    jest.spyOn(fileUtils, 'readTasksFile').mockResolvedValue(existingContent);
    ((global as any).PluginAPI.getTasks as jest.Mock).mockResolvedValue(mockTasks);
    ((global as any).PluginAPI.getAllProjects as jest.Mock).mockResolvedValue(mockProjects);

    await spToMd(mockConfig);

    const written = (fileUtils.writeTasksFile as jest.Mock).mock.calls[0][1];

    // Section headers must be preserved
    expect(written).toContain('## My Project Tasks');
    expect(written).toContain('## Done');
    // Blank lines preserved
    expect(written).toContain('\n\n');
    // Note line preserved
    expect(written).toContain('  A note for task 1');
    // Task title and checkbox updated
    expect(written).toContain('- [x] <!--task1--> Task 1 (renamed)');
    expect(written).toContain('- [x] <!--task2--> Task 2');
  });
});

// ---------------------------------------------------------------------------
// mergeSpIntoExistingFile — unit tests
// ---------------------------------------------------------------------------

describe('mergeSpIntoExistingFile', () => {
  const makeTask = (id: string, title: string, isDone = false, parentId: string | null = null): Task =>
    ({ id, title, isDone, projectId: 'proj', parentId } as Task);

  const makeMap = (...tasks: Task[]): Map<string, Task> => {
    const m = new Map<string, Task>();
    tasks.forEach((t) => m.set(t.id!, t));
    return m;
  };

  it('updates checkbox state of an existing task', () => {
    const content = '- [ ] <!--abc--> Buy milk';
    const task = makeTask('abc', 'Buy milk', true);
    const result = mergeSpIntoExistingFile(content, makeMap(task), [task]);
    expect(result).toBe('- [x] <!--abc--> Buy milk @done');
  });

  it('updates task title when renamed in SP', () => {
    const content = '- [ ] <!--abc--> Old title';
    const task = makeTask('abc', 'New title', false);
    const result = mergeSpIntoExistingFile(content, makeMap(task), [task]);
    expect(result).toBe('- [ ] <!--abc--> New title');
  });

  it('preserves section headers verbatim', () => {
    const content = [
      '## Pending',
      '- [ ] <!--t1--> Task 1',
      '## Done',
      '- [x] <!--t2--> Task 2',
    ].join('\n');
    const t1 = makeTask('t1', 'Task 1', false);
    const t2 = makeTask('t2', 'Task 2', true);
    const result = mergeSpIntoExistingFile(content, makeMap(t1, t2), [t1, t2]);
    expect(result).toContain('## Pending');
    expect(result).toContain('## Done');
  });

  it('preserves blank lines verbatim', () => {
    const content = '- [ ] <!--t1--> Task 1\n\n- [ ] <!--t2--> Task 2';
    const t1 = makeTask('t1', 'Task 1', false);
    const t2 = makeTask('t2', 'Task 2', false);
    const result = mergeSpIntoExistingFile(content, makeMap(t1, t2), [t1, t2]);
    expect(result).toBe('- [ ] <!--t1--> Task 1\n\n- [ ] <!--t2--> Task 2');
  });

  it('preserves note lines under existing tasks', () => {
    const content = '- [ ] <!--t1--> Task\n  A note here';
    const t1 = makeTask('t1', 'Task', false);
    const result = mergeSpIntoExistingFile(content, makeMap(t1), [t1]);
    expect(result).toContain('  A note here');
  });

  it('removes a task deleted in SP and its note lines', () => {
    const content = [
      '- [ ] <!--deleted-id--> Removed task',
      '  Note for removed task',
      '- [ ] <!--kept-id--> Kept task',
    ].join('\n');
    const keptTask = makeTask('kept-id', 'Kept task', false);
    const result = mergeSpIntoExistingFile(content, makeMap(keptTask), [keptTask]);
    expect(result).not.toContain('Removed task');
    expect(result).not.toContain('Note for removed task');
    expect(result).toContain('Kept task');
  });

  it('keeps a section header after a deleted task (does not skip it)', () => {
    const content = [
      '- [ ] <!--deleted-id--> Removed task',
      '  A note',
      '## Still Here',
      '- [ ] <!--kept-id--> Kept task',
    ].join('\n');
    const keptTask = makeTask('kept-id', 'Kept task', false);
    const result = mergeSpIntoExistingFile(content, makeMap(keptTask), [keptTask]);
    expect(result).toContain('## Still Here');
    expect(result).not.toContain('Removed task');
    expect(result).not.toContain('A note');
  });

  it('keeps a blank line after a deleted task', () => {
    const content = [
      '- [ ] <!--deleted-id--> Removed',
      '',
      '- [ ] <!--kept-id--> Kept',
    ].join('\n');
    const keptTask = makeTask('kept-id', 'Kept', false);
    const result = mergeSpIntoExistingFile(content, makeMap(keptTask), [keptTask]);
    // The blank line (non-task content) is preserved; deleted task line is gone
    const resultLines = result.split('\n');
    expect(resultLines).toContain(''); // blank line preserved
    expect(result).toContain('Kept');
    expect(result).not.toContain('Removed');
  });

  it('keeps task lines with no <!--id--> unchanged when no SP task matches by title', () => {
    const content = '- [ ] Task without id';
    const result = mergeSpIntoExistingFile(content, new Map(), []);
    expect(result).toBe('- [ ] Task without id');
  });

  it('stamps <!--id--> onto a no-ID line when an SP task matches by title (initial sync)', () => {
    const content = '- [ ] Buy milk';
    const task = makeTask('abc123', 'Buy milk', false);
    const result = mergeSpIntoExistingFile(content, makeMap(task), [task]);
    expect(result).toBe('- [ ] <!--abc123--> Buy milk');
  });

  it('stamps IDs onto multiple no-ID lines matching SP tasks by title', () => {
    const content = '- [ ] Task A\n- [ ] Task B';
    const taskA = makeTask('id-a', 'Task A', false);
    const taskB = makeTask('id-b', 'Task B', true);
    const result = mergeSpIntoExistingFile(content, makeMap(taskA, taskB), [taskA, taskB]);
    expect(result).toContain('<!--id-a--> Task A');
    expect(result).toContain('<!--id-b--> Task B');
    // No tasks should be appended at the end (both were matched)
    expect(result.split('\n').length).toBe(2);
  });

  it('prefers subtask SP task for indented no-ID lines', () => {
    const parent = makeTask('pid', 'Parent', false);
    const child = makeTask('cid', 'Child', false, 'pid');
    const content = '- [ ] Parent\n  - [ ] Child';
    const result = mergeSpIntoExistingFile(content, makeMap(parent, child), [parent, child]);
    expect(result).toContain('- [ ] <!--pid--> Parent');
    expect(result).toContain('  - [ ] <!--cid--> Child');
  });

  it('appends new SP tasks not in the file', () => {
    const content = '- [ ] <!--existing--> Existing task';
    const existingTask = makeTask('existing', 'Existing task', false);
    const newTask = makeTask('new-task', 'Brand new task', false);
    const result = mergeSpIntoExistingFile(content, makeMap(existingTask, newTask), [existingTask, newTask]);
    expect(result).toContain('Existing task');
    expect(result).toContain('Brand new task');
    // New task should appear after existing content
    expect(result.indexOf('Existing task')).toBeLessThan(result.indexOf('Brand new task'));
  });

  // C1: conditional blank separator when appending new tasks.
  it('does NOT insert a blank when the last line is a task line (C1)', () => {
    const content = '- [ ] <!--existing--> Existing task';
    const existingTask = makeTask('existing', 'Existing task', false);
    const newTask = makeTask('new-task', 'Brand new task', false);
    const result = mergeSpIntoExistingFile(content, makeMap(existingTask, newTask), [existingTask, newTask]);
    const lines = result.split('\n');
    // New task joins the list directly, no spurious blank between the two tasks.
    expect(lines).not.toContain('');
    expect(lines[lines.length - 1]).toContain('Brand new task');
  });

  it('inserts a blank when the last line is a note / free-form text (C1)', () => {
    const content = '- [ ] <!--existing--> Existing task\nSome trailing note';
    const existingTask = makeTask('existing', 'Existing task', false);
    const newTask = makeTask('new-task', 'Brand new task', false);
    const result = mergeSpIntoExistingFile(content, makeMap(existingTask, newTask), [existingTask, newTask]);
    const lines = result.split('\n');
    const noteIdx = lines.indexOf('Some trailing note');
    // A blank line closes the note before the new task block.
    expect(lines[noteIdx + 1]).toBe('');
    expect(result.indexOf('Some trailing note')).toBeLessThan(result.indexOf('Brand new task'));
  });

  it('inserts a blank when the last line is a section header (C1)', () => {
    const content = '- [ ] <!--existing--> Existing task\n## Later section';
    const existingTask = makeTask('existing', 'Existing task', false);
    const newTask = makeTask('new-task', 'Brand new task', false);
    const result = mergeSpIntoExistingFile(content, makeMap(existingTask, newTask), [existingTask, newTask]);
    const lines = result.split('\n');
    const headerIdx = lines.indexOf('## Later section');
    // A section header is free-form text → still gets the separator.
    expect(lines[headerIdx + 1]).toBe('');
    expect(result.indexOf('## Later section')).toBeLessThan(result.indexOf('Brand new task'));
  });

  it('preserves document header (non-task content before first task)', () => {
    const content = [
      '# My Tasks File',
      'Some introductory text.',
      '',
      '- [ ] <!--t1--> A task',
    ].join('\n');
    const t1 = makeTask('t1', 'A task', false);
    const result = mergeSpIntoExistingFile(content, makeMap(t1), [t1]);
    expect(result).toContain('# My Tasks File');
    expect(result).toContain('Some introductory text.');
  });

  it('preserves subtask indent when updating', () => {
    const content = [
      '- [ ] <!--parent--> Parent',
      '  - [ ] <!--child--> Child',
    ].join('\n');
    const parent = makeTask('parent', 'Parent', false);
    const child = makeTask('child', 'Child', true, 'parent');
    const result = mergeSpIntoExistingFile(content, makeMap(parent, child), [parent, child]);
    expect(result).toContain('  - [x] <!--child--> Child');
  });
});
