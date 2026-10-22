import { findRemovedProjectFolders } from '../folder-delete';

const ids = (...xs: string[]) => new Set(xs);

describe('findRemovedProjectFolders', () => {
  it('reports a linked folder whose project is gone while the folder is still there', () => {
    expect(findRemovedProjectFolders({ p1: 'Old' }, ['Old'], ids('p2'))).toEqual([
      { projectId: 'p1', folder: 'Old' },
    ]);
  });

  it('ignores a link whose project still exists', () => {
    expect(findRemovedProjectFolders({ p1: 'Old' }, ['Old'], ids('p1'))).toEqual([]);
  });

  it('ignores a link whose folder is gone (that is a deleted folder, handled elsewhere)', () => {
    expect(findRemovedProjectFolders({ p1: 'Old' }, ['Other'], ids('p2'))).toEqual([]);
  });

  it('skips manual binds to a .md file', () => {
    expect(findRemovedProjectFolders({ p1: 'Inbox/backlog.md' }, ['Inbox/backlog.md'], ids())).toEqual([]);
  });

  it('reports only the removed projects when several are linked', () => {
    const links = { p1: 'A', p2: 'B', p3: 'C' };
    expect(findRemovedProjectFolders(links, ['A', 'B', 'C'], ids('p1', 'p3'))).toEqual([
      { projectId: 'p2', folder: 'B' },
    ]);
  });
});
