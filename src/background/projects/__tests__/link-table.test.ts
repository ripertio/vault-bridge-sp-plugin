import { buildLinkTable, ignoreRow, unignoreRow } from '../link-table';

const P = (id: string, title: string) => ({ id, title });

describe('buildLinkTable', () => {
  it('marks a folder with the same-title project as linked', () => {
    const rows = buildLinkTable(['Alpha'], [P('p1', 'Alpha')], []);
    expect(rows).toEqual([{ name: 'Alpha', folder: 'Alpha', projectId: 'p1', projectTitle: 'Alpha', state: 'linked' }]);
  });

  it('marks folder-only and project-only rows', () => {
    const rows = buildLinkTable(['New'], [P('p2', 'Beta')], []);
    expect(rows.find((r) => r.folder === 'New')?.state).toBe('folder-only');
    expect(rows.find((r) => r.projectId === 'p2')?.state).toBe('project-only');
  });

  it('marks an excluded name as excluded, on the folder side', () => {
    const rows = buildLinkTable(['Skip'], [P('p1', 'Skip')], ['Skip']);
    expect(rows.find((r) => r.name === 'Skip')?.state).toBe('excluded');
  });

  it('keeps an excluded name that has neither a folder nor a project', () => {
    const rows = buildLinkTable([], [], ['Gone']);
    expect(rows).toEqual([{ name: 'Gone', folder: null, projectId: null, projectTitle: null, state: 'excluded' }]);
  });

  it('marks duplicate titles as ambiguous', () => {
    const rows = buildLinkTable(['Dup'], [P('p1', 'Dup'), P('p2', 'Dup')], []);
    expect(rows.find((r) => r.name === 'Dup')?.state).toBe('ambiguous');
  });

  it('never lists the Inbox as a project row', () => {
    const rows = buildLinkTable([], [P('INBOX_PROJECT', 'Inbox')], []);
    expect(rows).toEqual([]);
  });
});

describe('ignoreRow / unignoreRow', () => {
  it('ignore adds the name once', () => {
    expect(ignoreRow(['A'], 'B')).toEqual(['A', 'B']);
    expect(ignoreRow(['A'], 'A')).toEqual(['A']);
  });

  it('unignore removes the name', () => {
    expect(unignoreRow(['A', 'B'], 'A')).toEqual(['B']);
  });
});
