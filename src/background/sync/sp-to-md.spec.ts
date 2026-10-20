import {
  convertTasksToMarkdown as formatTasksAsMarkdown,
  formatTask,
  mergeSpIntoExistingFile,
} from './sp-to-md';
import { Task } from '@super-productivity/plugin-api';

/** Build a taskId → Task map from a list of SP tasks (helper for merge tests). */
const buildTaskMap = (tasks: Task[]): Map<string, Task> => {
  const map = new Map<string, Task>();
  tasks.forEach((t) => t.id && map.set(t.id, t));
  return map;
};

describe('sp-to-md', () => {
  describe('formatTask', () => {
    it('should format a simple task without ID', () => {
      const task = {
        id: null,
        title: 'Simple task',
        isDone: false,
      } as unknown as Task;

      const result = formatTask(task);
      expect(result).toBe('- [ ] Simple task');
    });

    it('should format a simple task with ID', () => {
      const task: Task = {
        id: 'task-123',
        title: 'Task with ID',
        isDone: false,
      } as Task;

      const result = formatTask(task);
      expect(result).toBe('- [ ] <!--task-123--> Task with ID');
    });

    it('should format a completed task', () => {
      const task: Task = {
        id: 'task-456',
        title: 'Completed task',
        isDone: true,
      } as Task;

      const result = formatTask(task);
      expect(result).toBe('- [x] <!--task-456--> Completed task @done');
    });

    it('should format a subtask with indentation', () => {
      const task: Task = {
        id: 'sub-123',
        title: 'Subtask',
        isDone: false,
      } as Task;

      const result = formatTask(task, 2);
      expect(result).toBe('  - [ ] <!--sub-123--> Subtask');
    });
  });

  describe('formatTasksAsMarkdown', () => {
    it('should format a single task without blank lines', () => {
      const tasks: Task[] = [
        {
          id: 'task-1',
          title: 'Single task',
          isDone: false,
          projectId: 'project-1',
        } as Task,
      ];

      const result = formatTasksAsMarkdown(tasks);
      expect(result).toBe('- [ ] <!--task-1--> Single task');
    });

    it('should format multiple tasks without blank lines between them', () => {
      const tasks: Task[] = [
        {
          id: 'task-1',
          title: 'First task',
          isDone: false,
          projectId: 'project-1',
        } as Task,
        {
          id: 'task-2',
          title: 'Second task',
          isDone: true,
          projectId: 'project-1',
        } as Task,
        {
          id: 'task-3',
          title: 'Third task',
          isDone: false,
          projectId: 'project-1',
        } as Task,
      ];

      const result = formatTasksAsMarkdown(tasks);
      const expected = `- [ ] <!--task-1--> First task
- [x] <!--task-2--> Second task @done
- [ ] <!--task-3--> Third task`;

      expect(result).toBe(expected);
      expect(result.split('\n').length).toBe(3); // Ensure no extra lines
    });

    it('should format tasks with subtasks properly indented', () => {
      const tasks: Task[] = [
        {
          id: 'parent-1',
          title: 'Parent task',
          isDone: false,
          projectId: 'project-1',
          subTaskIds: ['sub-1', 'sub-2'],
        } as Task,
        {
          id: 'sub-1',
          title: 'Subtask 1',
          isDone: false,
          parentId: 'parent-1',
          projectId: 'project-1',
        } as Task,
        {
          id: 'sub-2',
          title: 'Subtask 2',
          isDone: true,
          parentId: 'parent-1',
          projectId: 'project-1',
        } as Task,
      ];

      const result = formatTasksAsMarkdown(tasks);
      const expected = `- [ ] <!--parent-1--> Parent task
  - [ ] <!--sub-1--> Subtask 1
  - [x] <!--sub-2--> Subtask 2 @done`;

      expect(result).toBe(expected);
    });

    it('should format multiple parent tasks with subtasks without blank lines', () => {
      const tasks: Task[] = [
        {
          id: 'parent-1',
          title: 'First parent',
          isDone: false,
          projectId: 'project-1',
          subTaskIds: ['sub-1'],
        } as Task,
        {
          id: 'sub-1',
          title: 'Subtask of first',
          isDone: false,
          parentId: 'parent-1',
          projectId: 'project-1',
        } as Task,
        {
          id: 'parent-2',
          title: 'Second parent',
          isDone: false,
          projectId: 'project-1',
          subTaskIds: ['sub-2'],
        } as Task,
        {
          id: 'sub-2',
          title: 'Subtask of second',
          isDone: true,
          parentId: 'parent-2',
          projectId: 'project-1',
        } as Task,
      ];

      const result = formatTasksAsMarkdown(tasks);
      const expected = `- [ ] <!--parent-1--> First parent
  - [ ] <!--sub-1--> Subtask of first
- [ ] <!--parent-2--> Second parent
  - [x] <!--sub-2--> Subtask of second @done`;

      expect(result).toBe(expected);
      expect(result.split('\n').length).toBe(4); // No blank lines between groups
    });

    it('should handle tasks with notes without adding blank lines', () => {
      const tasks: Task[] = [
        {
          id: 'task-1',
          title: 'Task with notes',
          isDone: false,
          projectId: 'project-1',
          notes: 'This is a note\nMultiline note',
        } as Task,
        {
          id: 'task-2',
          title: 'Another task',
          isDone: false,
          projectId: 'project-1',
        } as Task,
      ];

      const result = formatTasksAsMarkdown(tasks);
      const expected = `- [ ] <!--task-1--> Task with notes
  This is a note
  Multiline note
- [ ] <!--task-2--> Another task`;

      expect(result).toBe(expected);
    });

    it('should handle subtasks with notes', () => {
      const tasks: Task[] = [
        {
          id: 'parent-1',
          title: 'Parent task',
          isDone: false,
          projectId: 'project-1',
          subTaskIds: ['sub-1'],
        } as Task,
        {
          id: 'sub-1',
          title: 'Subtask with notes',
          isDone: false,
          parentId: 'parent-1',
          projectId: 'project-1',
          notes: 'Subtask note line 1\nSubtask note line 2',
        } as Task,
      ];

      const result = formatTasksAsMarkdown(tasks);
      const expected = `- [ ] <!--parent-1--> Parent task
  - [ ] <!--sub-1--> Subtask with notes
    Subtask note line 1
    Subtask note line 2`;

      expect(result).toBe(expected);
    });

    it('should handle empty task list', () => {
      const tasks: Task[] = [];
      const result = formatTasksAsMarkdown(tasks);
      expect(result).toBe('');
    });

    it('should handle orphaned subtasks gracefully', () => {
      const tasks: Task[] = [
        {
          id: 'orphan-sub',
          title: 'Orphaned subtask',
          isDone: false,
          parentId: 'non-existent-parent',
          projectId: 'project-1',
        } as Task,
      ];

      const result = formatTasksAsMarkdown(tasks);
      // Orphaned subtasks should still be included, just not indented
      expect(result).toBe('- [ ] <!--orphan-sub--> Orphaned subtask');
    });
  });

  describe('mergeSpIntoExistingFile (issue #12 — subtask indentation)', () => {
    it('inserts a new subtask indented under its existing parent (not flat at the end)', () => {
      const existing = ['- [ ] <!--P--> Parent', '- [ ] <!--Q--> Other'].join('\n');

      const tasks: Task[] = [
        { id: 'P', title: 'Parent', isDone: false, parentId: null, subTaskIds: ['S'] } as Task,
        { id: 'S', title: 'Sub', isDone: false, parentId: 'P' } as Task,
        { id: 'Q', title: 'Other', isDone: false, parentId: null } as Task,
      ];
      const spTaskMap = buildTaskMap(tasks);
      // orderedTasks: parents first, then subtasks (as spToMd builds it)
      const orderedTasks = [tasks[0], tasks[2], tasks[1]];

      const result = mergeSpIntoExistingFile(existing, spTaskMap, orderedTasks);

      expect(result).toBe(
        [
          '- [ ] <!--P--> Parent',
          // no indent detectable in the existing file → detectIndentString
          // default (4 spaces, since commit 879390f)
          '    - [ ] <!--S--> Sub',
          '- [ ] <!--Q--> Other',
        ].join('\n'),
      );
    });

    it('reuses a TAB indent when the file uses tabs (issue #12 follow-up)', () => {
      const existing = [
        '- [ ] <!--P--> Parent',
        '\t- [x] <!--S1--> Sub 1',
        '- [ ] <!--Q--> Other',
      ].join('\n');

      const tasks: Task[] = [
        {
          id: 'P',
          title: 'Parent',
          isDone: false,
          parentId: null,
          subTaskIds: ['S1', 'S2'],
        } as Task,
        { id: 'S1', title: 'Sub 1', isDone: true, parentId: 'P' } as Task,
        { id: 'S2', title: 'Sub 2', isDone: false, parentId: 'P' } as Task,
        { id: 'Q', title: 'Other', isDone: false, parentId: null } as Task,
      ];
      const spTaskMap = buildTaskMap(tasks);
      const orderedTasks = [tasks[0], tasks[3], tasks[1], tasks[2]];

      const result = mergeSpIntoExistingFile(existing, spTaskMap, orderedTasks);

      // New subtask must be indented with a TAB, matching the existing subtask.
      expect(result).toBe(
        [
          '- [ ] <!--P--> Parent',
          '\t- [x] <!--S1--> Sub 1 @done',
          '\t- [ ] <!--S2--> Sub 2',
          '- [ ] <!--Q--> Other',
        ].join('\n'),
      );
    });

    it('respects the file’s existing indent unit (1 space) and orders by subTaskIds', () => {
      const existing = [
        '- [ ] <!--P--> Parent',
        ' - [ ] <!--S1--> Sub 1',
        '- [ ] <!--Q--> Other',
      ].join('\n');

      const tasks: Task[] = [
        {
          id: 'P',
          title: 'Parent',
          isDone: false,
          parentId: null,
          subTaskIds: ['S1', 'S2'],
        } as Task,
        { id: 'S1', title: 'Sub 1', isDone: false, parentId: 'P' } as Task,
        { id: 'S2', title: 'Sub 2', isDone: true, parentId: 'P' } as Task,
        { id: 'Q', title: 'Other', isDone: false, parentId: null } as Task,
      ];
      const spTaskMap = buildTaskMap(tasks);
      const orderedTasks = [tasks[0], tasks[3], tasks[1], tasks[2]];

      const result = mergeSpIntoExistingFile(existing, spTaskMap, orderedTasks);

      expect(result).toBe(
        [
          '- [ ] <!--P--> Parent',
          ' - [ ] <!--S1--> Sub 1',
          ' - [x] <!--S2--> Sub 2 @done',
          '- [ ] <!--Q--> Other',
        ].join('\n'),
      );
    });

    it('appends a brand-new parent with its new subtasks, nested', () => {
      const existing = '- [ ] <!--E--> Existing';

      const tasks: Task[] = [
        { id: 'E', title: 'Existing', isDone: false, parentId: null } as Task,
        {
          id: 'P',
          title: 'Parent',
          isDone: false,
          parentId: null,
          subTaskIds: ['S1', 'S2'],
        } as Task,
        { id: 'S1', title: 'Sub 1', isDone: false, parentId: 'P' } as Task,
        { id: 'S2', title: 'Sub 2', isDone: true, parentId: 'P' } as Task,
      ];
      const spTaskMap = buildTaskMap(tasks);
      const orderedTasks = [tasks[0], tasks[1], tasks[2], tasks[3]];

      const result = mergeSpIntoExistingFile(existing, spTaskMap, orderedTasks);

      // C1: last existing line is a task → new tasks join the list with no
      // spurious blank separator.
      expect(result).toBe(
        [
          '- [ ] <!--E--> Existing',
          '- [ ] <!--P--> Parent',
          '  - [ ] <!--S1--> Sub 1',
          '  - [x] <!--S2--> Sub 2 @done',
        ].join('\n'),
      );
    });
  });

  describe('mergeSpIntoExistingFile (Bug #47 — parentId change relocation)', () => {
    it('promotes a mid-block subtask, leaving its trailing siblings under the parent', () => {
      const existing = [
        '- [ ] <!--P--> Parent',
        '    - [ ] <!--A--> Sub A',
        '    - [ ] <!--B--> Sub B',
        '    - [ ] <!--C--> Sub C',
      ].join('\n');

      // B promoted to root: P keeps [A, C]; B is now a parentless task.
      const tasks: Task[] = [
        { id: 'P', title: 'Parent', isDone: false, parentId: null, subTaskIds: ['A', 'C'] } as Task,
        { id: 'A', title: 'Sub A', isDone: false, parentId: 'P' } as Task,
        { id: 'C', title: 'Sub C', isDone: false, parentId: 'P' } as Task,
        { id: 'B', title: 'Sub B', isDone: false, parentId: null } as Task,
      ];
      const spTaskMap = buildTaskMap(tasks);
      const orderedTasks = [tasks[0], tasks[3], tasks[1], tasks[2]]; // parents first, then subs

      const result = mergeSpIntoExistingFile(existing, spTaskMap, orderedTasks);

      expect(result).toBe(
        [
          '- [ ] <!--P--> Parent',
          '    - [ ] <!--A--> Sub A',
          '    - [ ] <!--C--> Sub C',
          '- [ ] <!--B--> Sub B', // relocated to root — does NOT capture C
        ].join('\n'),
      );
    });

    it('promotes the last subtask of a parent', () => {
      const existing = [
        '- [ ] <!--P--> Parent',
        '    - [ ] <!--A--> Sub A',
        '    - [ ] <!--B--> Sub B',
      ].join('\n');

      const tasks: Task[] = [
        { id: 'P', title: 'Parent', isDone: false, parentId: null, subTaskIds: ['A'] } as Task,
        { id: 'A', title: 'Sub A', isDone: false, parentId: 'P' } as Task,
        { id: 'B', title: 'Sub B', isDone: false, parentId: null } as Task,
      ];
      const spTaskMap = buildTaskMap(tasks);
      const orderedTasks = [tasks[0], tasks[2], tasks[1]];

      const result = mergeSpIntoExistingFile(existing, spTaskMap, orderedTasks);

      expect(result).toBe(
        [
          '- [ ] <!--P--> Parent',
          '    - [ ] <!--A--> Sub A',
          '- [ ] <!--B--> Sub B',
        ].join('\n'),
      );
    });

    it('demotes a root task into an existing parent (appended after its subtree)', () => {
      const existing = [
        '- [ ] <!--P--> Parent',
        '    - [ ] <!--A--> Sub A',
        '- [ ] <!--D--> Task D',
      ].join('\n');

      // D demoted under P: P now has [A, D].
      const tasks: Task[] = [
        { id: 'P', title: 'Parent', isDone: false, parentId: null, subTaskIds: ['A', 'D'] } as Task,
        { id: 'A', title: 'Sub A', isDone: false, parentId: 'P' } as Task,
        { id: 'D', title: 'Task D', isDone: false, parentId: 'P' } as Task,
      ];
      const spTaskMap = buildTaskMap(tasks);
      const orderedTasks = [tasks[0], tasks[1], tasks[2]];

      const result = mergeSpIntoExistingFile(existing, spTaskMap, orderedTasks);

      expect(result).toBe(
        [
          '- [ ] <!--P--> Parent',
          '    - [ ] <!--A--> Sub A',
          '    - [ ] <!--D--> Task D',
        ].join('\n'),
      );
    });

    it('demotes a root task into a MID-block parent (before later root tasks)', () => {
      const existing = [
        '- [ ] <!--P--> Parent',
        '    - [ ] <!--A--> Sub A',
        '- [ ] <!--Q--> Other',
        '- [ ] <!--D--> Task D',
      ].join('\n');

      const tasks: Task[] = [
        { id: 'P', title: 'Parent', isDone: false, parentId: null, subTaskIds: ['A', 'D'] } as Task,
        { id: 'A', title: 'Sub A', isDone: false, parentId: 'P' } as Task,
        { id: 'Q', title: 'Other', isDone: false, parentId: null } as Task,
        { id: 'D', title: 'Task D', isDone: false, parentId: 'P' } as Task,
      ];
      const spTaskMap = buildTaskMap(tasks);
      const orderedTasks = [tasks[0], tasks[2], tasks[1], tasks[3]];

      const result = mergeSpIntoExistingFile(existing, spTaskMap, orderedTasks);

      expect(result).toBe(
        [
          '- [ ] <!--P--> Parent',
          '    - [ ] <!--A--> Sub A',
          '    - [ ] <!--D--> Task D', // inserted under P, after its subtree
          '- [ ] <!--Q--> Other',
        ].join('\n'),
      );
    });

    it('is a no-op on the next sync (round-trip stable after a promotion)', () => {
      // The already-relocated file from the first test, same SP state.
      const existing = [
        '- [ ] <!--P--> Parent',
        '    - [ ] <!--A--> Sub A',
        '    - [ ] <!--C--> Sub C',
        '- [ ] <!--B--> Sub B',
      ].join('\n');

      const tasks: Task[] = [
        { id: 'P', title: 'Parent', isDone: false, parentId: null, subTaskIds: ['A', 'C'] } as Task,
        { id: 'A', title: 'Sub A', isDone: false, parentId: 'P' } as Task,
        { id: 'C', title: 'Sub C', isDone: false, parentId: 'P' } as Task,
        { id: 'B', title: 'Sub B', isDone: false, parentId: null } as Task,
      ];
      const spTaskMap = buildTaskMap(tasks);
      const orderedTasks = [tasks[0], tasks[3], tasks[1], tasks[2]];

      const result = mergeSpIntoExistingFile(existing, spTaskMap, orderedTasks);

      expect(result).toBe(existing); // byte-identical — converged
    });

    it('carries the task notes when demoting (relocated task keeps its notes)', () => {
      const existing = [
        '- [ ] <!--P--> Parent',
        '- [ ] <!--D--> Task D',
        '    a note for D',
      ].join('\n');

      const tasks: Task[] = [
        { id: 'P', title: 'Parent', isDone: false, parentId: null, subTaskIds: ['D'] } as Task,
        { id: 'D', title: 'Task D', isDone: false, parentId: 'P', notes: 'a note for D' } as Task,
      ];
      const spTaskMap = buildTaskMap(tasks);
      const orderedTasks = [tasks[0], tasks[1]];

      const result = mergeSpIntoExistingFile(existing, spTaskMap, orderedTasks);

      expect(result).toBe(
        [
          '- [ ] <!--P--> Parent',
          '    - [ ] <!--D--> Task D',
          '        a note for D', // note travels, indented one level deeper
        ].join('\n'),
      );
    });

    it('preserves an existing @done date when promoting a completed subtask', () => {
      const existing = [
        '- [ ] <!--P--> Parent',
        '    - [x] <!--B--> Done sub @done(2026-01-01 09:30)',
      ].join('\n');

      // B promoted to root; SP has doneOn null (date lived only in the file).
      const tasks: Task[] = [
        { id: 'P', title: 'Parent', isDone: false, parentId: null } as Task,
        { id: 'B', title: 'Done sub', isDone: true, doneOn: null, parentId: null } as Task,
      ];
      const spTaskMap = buildTaskMap(tasks);
      const orderedTasks = [tasks[0], tasks[1]];

      const result = mergeSpIntoExistingFile(existing, spTaskMap, orderedTasks);

      expect(result).toBe(
        [
          '- [ ] <!--P--> Parent',
          '- [x] <!--B--> Done sub @done(2026-01-01 09:30)', // date kept
        ].join('\n'),
      );
    });
  });

  describe('mergeSpIntoExistingFile (v0.4.2 — relocated subtask honors subTaskIds position)', () => {
    it('inserts a demoted task at its MIDDLE position within the parent group', () => {
      const existing = [
        '- [ ] <!--P--> Parent',
        '    - [ ] <!--A--> Sub A',
        '    - [ ] <!--C--> Sub C',
        '- [ ] <!--D--> Task D',
      ].join('\n');

      // D demoted BETWEEN A and C: SP order is [A, D, C].
      const tasks: Task[] = [
        { id: 'P', title: 'Parent', isDone: false, parentId: null, subTaskIds: ['A', 'D', 'C'] } as Task,
        { id: 'A', title: 'Sub A', isDone: false, parentId: 'P' } as Task,
        { id: 'D', title: 'Task D', isDone: false, parentId: 'P' } as Task,
        { id: 'C', title: 'Sub C', isDone: false, parentId: 'P' } as Task,
      ];
      const spTaskMap = buildTaskMap(tasks);
      const orderedTasks = [tasks[0], tasks[1], tasks[2], tasks[3]];

      const result = mergeSpIntoExistingFile(existing, spTaskMap, orderedTasks);

      expect(result).toBe(
        [
          '- [ ] <!--P--> Parent',
          '    - [ ] <!--A--> Sub A',
          '    - [ ] <!--D--> Task D', // between A and C, not appended at the end
          '    - [ ] <!--C--> Sub C',
        ].join('\n'),
      );
    });

    it('inserts a demoted task at the FIRST slot (right after the parent line)', () => {
      const existing = [
        '- [ ] <!--P--> Parent',
        '    - [ ] <!--A--> Sub A',
        '- [ ] <!--D--> Task D',
      ].join('\n');

      // D demoted to the FIRST subtask slot: SP order is [D, A].
      const tasks: Task[] = [
        { id: 'P', title: 'Parent', isDone: false, parentId: null, subTaskIds: ['D', 'A'] } as Task,
        { id: 'A', title: 'Sub A', isDone: false, parentId: 'P' } as Task,
        { id: 'D', title: 'Task D', isDone: false, parentId: 'P' } as Task,
      ];
      const spTaskMap = buildTaskMap(tasks);
      const orderedTasks = [tasks[0], tasks[2], tasks[1]];

      const result = mergeSpIntoExistingFile(existing, spTaskMap, orderedTasks);

      expect(result).toBe(
        [
          '- [ ] <!--P--> Parent',
          '    - [ ] <!--D--> Task D', // first child, before A
          '    - [ ] <!--A--> Sub A',
        ].join('\n'),
      );
    });

    it('places the FIRST-slot child after the parent’s own note lines', () => {
      const existing = [
        '- [ ] <!--P--> Parent',
        '    a note that belongs to the parent',
        '    - [ ] <!--A--> Sub A',
        '- [ ] <!--D--> Task D',
      ].join('\n');

      const tasks: Task[] = [
        { id: 'P', title: 'Parent', isDone: false, parentId: null, subTaskIds: ['D', 'A'] } as Task,
        { id: 'A', title: 'Sub A', isDone: false, parentId: 'P' } as Task,
        { id: 'D', title: 'Task D', isDone: false, parentId: 'P' } as Task,
      ];
      const spTaskMap = buildTaskMap(tasks);
      const orderedTasks = [tasks[0], tasks[2], tasks[1]];

      const result = mergeSpIntoExistingFile(existing, spTaskMap, orderedTasks);

      expect(result).toBe(
        [
          '- [ ] <!--P--> Parent',
          '    a note that belongs to the parent', // parent note stays put
          '    - [ ] <!--D--> Task D', // first child, after the note, before A
          '    - [ ] <!--A--> Sub A',
        ].join('\n'),
      );
    });

    it('interleaves TWO new subtasks at their subTaskIds positions', () => {
      const existing = [
        '- [ ] <!--P--> Parent',
        '    - [ ] <!--A--> Sub A',
        '    - [ ] <!--C--> Sub C',
        '- [ ] <!--X--> Task X',
        '- [ ] <!--Y--> Task Y',
      ].join('\n');

      // X and Y demoted under P: SP order is [A, X, C, Y].
      const tasks: Task[] = [
        { id: 'P', title: 'Parent', isDone: false, parentId: null, subTaskIds: ['A', 'X', 'C', 'Y'] } as Task,
        { id: 'A', title: 'Sub A', isDone: false, parentId: 'P' } as Task,
        { id: 'X', title: 'Task X', isDone: false, parentId: 'P' } as Task,
        { id: 'C', title: 'Sub C', isDone: false, parentId: 'P' } as Task,
        { id: 'Y', title: 'Task Y', isDone: false, parentId: 'P' } as Task,
      ];
      const spTaskMap = buildTaskMap(tasks);
      const orderedTasks = [tasks[0], tasks[1], tasks[2], tasks[3], tasks[4]];

      const result = mergeSpIntoExistingFile(existing, spTaskMap, orderedTasks);

      expect(result).toBe(
        [
          '- [ ] <!--P--> Parent',
          '    - [ ] <!--A--> Sub A',
          '    - [ ] <!--X--> Task X',
          '    - [ ] <!--C--> Sub C',
          '    - [ ] <!--Y--> Task Y',
        ].join('\n'),
      );
    });

    it('is round-trip stable after a mid-group demotion', () => {
      const existing = [
        '- [ ] <!--P--> Parent',
        '    - [ ] <!--A--> Sub A',
        '    - [ ] <!--D--> Task D',
        '    - [ ] <!--C--> Sub C',
      ].join('\n');

      const tasks: Task[] = [
        { id: 'P', title: 'Parent', isDone: false, parentId: null, subTaskIds: ['A', 'D', 'C'] } as Task,
        { id: 'A', title: 'Sub A', isDone: false, parentId: 'P' } as Task,
        { id: 'D', title: 'Task D', isDone: false, parentId: 'P' } as Task,
        { id: 'C', title: 'Sub C', isDone: false, parentId: 'P' } as Task,
      ];
      const spTaskMap = buildTaskMap(tasks);
      const orderedTasks = [tasks[0], tasks[1], tasks[2], tasks[3]];

      const result = mergeSpIntoExistingFile(existing, spTaskMap, orderedTasks);

      expect(result).toBe(existing); // byte-identical — converged
    });
  });

  describe('mergeSpIntoExistingFile (v0.4.2 — pure subtask REORDER reflected)', () => {
    it('reorders existing subtasks to match subTaskIds (no parentId change)', () => {
      const existing = [
        '- [ ] <!--P--> Parent',
        '    - [ ] <!--A--> Sub A',
        '    - [ ] <!--B--> Sub B',
        '    - [ ] <!--C--> Sub C',
      ].join('\n');

      // Pure reorder in SP: B moved to the front → [B, A, C]. No parent changed.
      const tasks: Task[] = [
        { id: 'P', title: 'Parent', isDone: false, parentId: null, subTaskIds: ['B', 'A', 'C'] } as Task,
        { id: 'A', title: 'Sub A', isDone: false, parentId: 'P' } as Task,
        { id: 'B', title: 'Sub B', isDone: false, parentId: 'P' } as Task,
        { id: 'C', title: 'Sub C', isDone: false, parentId: 'P' } as Task,
      ];
      const spTaskMap = buildTaskMap(tasks);
      const orderedTasks = [tasks[0], tasks[2], tasks[1], tasks[3]];

      const result = mergeSpIntoExistingFile(existing, spTaskMap, orderedTasks);

      expect(result).toBe(
        [
          '- [ ] <!--P--> Parent',
          '    - [ ] <!--B--> Sub B',
          '    - [ ] <!--A--> Sub A',
          '    - [ ] <!--C--> Sub C',
        ].join('\n'),
      );
    });

    it('carries each subtask’s notes when reordering', () => {
      const existing = [
        '- [ ] <!--P--> Parent',
        '    - [ ] <!--A--> Sub A',
        '        note of A',
        '    - [ ] <!--B--> Sub B',
        '        note of B',
      ].join('\n');

      // Swap: [B, A].
      const tasks: Task[] = [
        { id: 'P', title: 'Parent', isDone: false, parentId: null, subTaskIds: ['B', 'A'] } as Task,
        { id: 'A', title: 'Sub A', isDone: false, parentId: 'P', notes: 'note of A' } as Task,
        { id: 'B', title: 'Sub B', isDone: false, parentId: 'P', notes: 'note of B' } as Task,
      ];
      const spTaskMap = buildTaskMap(tasks);
      const orderedTasks = [tasks[0], tasks[2], tasks[1]];

      const result = mergeSpIntoExistingFile(existing, spTaskMap, orderedTasks);

      expect(result).toBe(
        [
          '- [ ] <!--P--> Parent',
          '    - [ ] <!--B--> Sub B',
          '        note of B', // B's note travels with B
          '    - [ ] <!--A--> Sub A',
          '        note of A', // A's note travels with A
        ].join('\n'),
      );
    });

    it('keeps the parent’s own notes ahead of the reordered children', () => {
      const existing = [
        '- [ ] <!--P--> Parent',
        '    a note that belongs to the parent',
        '    - [ ] <!--A--> Sub A',
        '    - [ ] <!--B--> Sub B',
      ].join('\n');

      const tasks: Task[] = [
        { id: 'P', title: 'Parent', isDone: false, parentId: null, subTaskIds: ['B', 'A'] } as Task,
        { id: 'A', title: 'Sub A', isDone: false, parentId: 'P' } as Task,
        { id: 'B', title: 'Sub B', isDone: false, parentId: 'P' } as Task,
      ];
      const spTaskMap = buildTaskMap(tasks);
      const orderedTasks = [tasks[0], tasks[2], tasks[1]];

      const result = mergeSpIntoExistingFile(existing, spTaskMap, orderedTasks);

      expect(result).toBe(
        [
          '- [ ] <!--P--> Parent',
          '    a note that belongs to the parent', // stays attached to the parent
          '    - [ ] <!--B--> Sub B',
          '    - [ ] <!--A--> Sub A',
        ].join('\n'),
      );
    });

    it('leaves root-level task order untouched (reorder is subtask-scoped)', () => {
      const existing = [
        '- [ ] <!--R1--> Root 1',
        '- [ ] <!--R2--> Root 2',
        '- [ ] <!--R3--> Root 3',
      ].join('\n');

      // SP order differs at root, but we do NOT reorder root tasks.
      const tasks: Task[] = [
        { id: 'R1', title: 'Root 1', isDone: false, parentId: null } as Task,
        { id: 'R2', title: 'Root 2', isDone: false, parentId: null } as Task,
        { id: 'R3', title: 'Root 3', isDone: false, parentId: null } as Task,
      ];
      const spTaskMap = buildTaskMap(tasks);
      const orderedTasks = [tasks[2], tasks[0], tasks[1]]; // SP: R3, R1, R2

      const result = mergeSpIntoExistingFile(existing, spTaskMap, orderedTasks);

      expect(result).toBe(existing); // root order preserved as-is
    });

    it('is round-trip stable after a reorder', () => {
      const existing = [
        '- [ ] <!--P--> Parent',
        '    - [ ] <!--B--> Sub B',
        '    - [ ] <!--A--> Sub A',
      ].join('\n');

      const tasks: Task[] = [
        { id: 'P', title: 'Parent', isDone: false, parentId: null, subTaskIds: ['B', 'A'] } as Task,
        { id: 'A', title: 'Sub A', isDone: false, parentId: 'P' } as Task,
        { id: 'B', title: 'Sub B', isDone: false, parentId: 'P' } as Task,
      ];
      const spTaskMap = buildTaskMap(tasks);
      const orderedTasks = [tasks[0], tasks[2], tasks[1]];

      const result = mergeSpIntoExistingFile(existing, spTaskMap, orderedTasks);

      expect(result).toBe(existing); // already in SP order → byte-identical
    });
  });
});
