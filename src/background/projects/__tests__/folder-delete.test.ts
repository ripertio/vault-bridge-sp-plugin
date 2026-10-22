import { findDeletedFolders } from '../folder-delete';

const ids = (...xs: string[]) => new Set(xs);

describe('findDeletedFolders', () => {
  it('reports a linked folder that is gone while its project still exists', () => {
    expect(findDeletedFolders({ p1: 'Old' }, ['Other'], ids('p1'), ids())).toEqual([
      { projectId: 'p1', folder: 'Old' },
    ]);
  });

  it('ignores a link whose folder still exists', () => {
    expect(findDeletedFolders({ p1: 'Same' }, ['Same'], ids('p1'), ids())).toEqual([]);
  });

  it('ignores a link whose SP project is gone (that is a project delete, not a folder delete)', () => {
    expect(findDeletedFolders({ p1: 'Old' }, [], ids(), ids())).toEqual([]);
  });

  it('ignores a folder that was renamed in this run', () => {
    expect(findDeletedFolders({ p1: 'Old' }, ['Renamed'], ids('p1'), ids('p1'))).toEqual([]);
  });

  it('ignores manual binds to a .md file', () => {
    expect(findDeletedFolders({ p1: 'Inbox/backlog.md' }, [], ids('p1'), ids())).toEqual([]);
  });
});
