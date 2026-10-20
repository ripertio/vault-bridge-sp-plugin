import { isStructuralTaskAction } from '../../sync/sync-manager';

/**
 * The `action` hook fires for EVERY NgRx action. We only want to trigger an
 * SP→MD sync for STRUCTURAL task changes that taskUpdate/anyTaskUpdate miss —
 * chiefly `[Task] Add SubTask`, which (verified on SP 18.16) never reaches the
 * task hooks, so adding a subtask never auto-synced. Pure edits go through
 * taskUpdate and must NOT match here (avoid double-sync); UI/selection actions
 * must never match.
 */
describe('isStructuralTaskAction', () => {
  it('matches subtask add/move (the reported bug) — incl. the logged variant', () => {
    expect(isStructuralTaskAction('[Task] Add SubTask')).toBe(true);
    expect(isStructuralTaskAction('[a][Task] Add SubTask')).toBe(true);
    expect(isStructuralTaskAction('[Task] Move SubTask')).toBe(true);
  });

  it('matches other structural task mutations', () => {
    expect(isStructuralTaskAction('[Task] Add Task')).toBe(true);
    expect(isStructuralTaskAction('[Task] Delete Task')).toBe(true);
    expect(isStructuralTaskAction('[Task] Move Task Up')).toBe(true);
    expect(isStructuralTaskAction('[Task] Convert To Main Task')).toBe(true);
    expect(isStructuralTaskAction('[Task] Undo Delete Task')).toBe(true);
  });

  it('does NOT match pure edits (already covered by taskUpdate)', () => {
    expect(isStructuralTaskAction('[Task] Update Task')).toBe(false);
    expect(isStructuralTaskAction('[Task] Update Task Ui')).toBe(false);
    expect(isStructuralTaskAction('[Task] Add Time Spent')).toBe(false);
  });

  it('does NOT match UI / selection / unrelated actions', () => {
    expect(isStructuralTaskAction('[Task] SetSelectedTask')).toBe(false);
    expect(isStructuralTaskAction('[Task] SetCurrentTask')).toBe(false);
    expect(isStructuralTaskAction('[Layout] Hide Non-Task Side Panel')).toBe(false);
    expect(isStructuralTaskAction('[Project] Update Project')).toBe(false);
  });

  // #9323 third review: the old substring filter over-matched because "remove"
  // contains "move", and only ACCIDENTALLY excluded remote/bulk applies (neither
  // contained "task"). The known-set matcher must reject all of these.
  it('does NOT match "remove" actions (the "move" substring trap)', () => {
    expect(isStructuralTaskAction('[Task] removeTasksFromTodayTag')).toBe(false);
    expect(isStructuralTaskAction('[Task] removeTagsForAllTasks')).toBe(false);
    expect(isStructuralTaskAction('[Task] Remove time spent')).toBe(false);
  });

  it('does NOT match remote / bulk apply actions (would fire a full SP→MD write)', () => {
    expect(isStructuralTaskAction('[OperationLog] Bulk Apply Operations')).toBe(false);
    expect(isStructuralTaskAction('[SP_ALL] Load(import) all data')).toBe(false);
  });
});
