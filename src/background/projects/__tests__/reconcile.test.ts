import { planReconcile } from '../reconcile';

describe('planReconcile', () => {
  it('turns folders without a project into project-creation candidates', () => {
    const plan = planReconcile({
      matched: [],
      foldersWithoutProject: ['New folder'],
      projectsWithoutFolder: [],
      ambiguous: [],
    });
    expect(plan.projectsToCreate).toEqual(['New folder']);
    expect(plan.foldersToCreate).toEqual([]);
  });

  it('turns projects without a folder into folder-creation candidates', () => {
    const plan = planReconcile({
      matched: [],
      foldersWithoutProject: [],
      projectsWithoutFolder: [{ id: 'p1', title: 'Beta' }],
      ambiguous: [],
    });
    expect(plan.foldersToCreate).toEqual([{ id: 'p1', title: 'Beta' }]);
  });

  it('never plans to create anything for ambiguous names', () => {
    const plan = planReconcile({
      matched: [],
      foldersWithoutProject: [],
      projectsWithoutFolder: [],
      ambiguous: ['Dup'],
    });
    expect(plan.projectsToCreate).toEqual([]);
    expect(plan.foldersToCreate).toEqual([]);
    expect(plan.ambiguous).toEqual(['Dup']);
  });
});
