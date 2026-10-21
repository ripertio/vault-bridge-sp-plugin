import { planRenames } from '../rename';

describe('planRenames', () => {
  it('renames the folder when the SP project was renamed', () => {
    const plan = planRenames(
      { p1: 'Old' },
      ['Old'],
      [{ id: 'p1', title: 'New' }],
    );
    expect(plan.renameFolders).toEqual([{ from: 'Old', to: 'New', projectId: 'p1' }]);
    expect(plan.renameProjects).toEqual([]);
  });

  it('renames the SP project when the folder was renamed', () => {
    const plan = planRenames(
      { p1: 'Old' },
      ['Renamed'],
      [{ id: 'p1', title: 'Old' }],
    );
    expect(plan.renameProjects).toEqual([{ projectId: 'p1', from: 'Old', to: 'Renamed' }]);
    expect(plan.renameFolders).toEqual([]);
  });

  it('does nothing when neither side changed', () => {
    const plan = planRenames({ p1: 'Same' }, ['Same'], [{ id: 'p1', title: 'Same' }]);
    expect(plan).toEqual({ renameFolders: [], renameProjects: [] });
  });

  it('does nothing when the SP side is renamed onto an existing folder', () => {
    const plan = planRenames(
      { p1: 'Old' },
      ['Old', 'New'],
      [{ id: 'p1', title: 'New' }],
    );
    expect(plan.renameFolders).toEqual([]);
  });

  it('does nothing when both sides changed (ambiguous)', () => {
    const plan = planRenames(
      { p1: 'Old' },
      ['Folder B', 'Folder C'],
      [{ id: 'p1', title: 'Project B' }],
    );
    expect(plan).toEqual({ renameFolders: [], renameProjects: [] });
  });

  it('never treats a deleted project as a rename', () => {
    const plan = planRenames({ p1: 'Gone' }, ['Other'], []);
    expect(plan).toEqual({ renameFolders: [], renameProjects: [] });
  });

  it('does not rename the SP project when several folders are unlinked', () => {
    const plan = planRenames(
      { p1: 'Old' },
      ['X', 'Y'],
      [{ id: 'p1', title: 'Old' }],
    );
    expect(plan.renameProjects).toEqual([]);
  });
});
