import { bindingsFromMatches } from '../auto-bindings';

describe('bindingsFromMatches', () => {
  it('creates one enabled binding per matched folder with a stable id', () => {
    const bindings = bindingsFromMatches(
      { matched: [{ folder: 'Alpha', projectId: 'p1' }], foldersWithoutProject: [], projectsWithoutFolder: [], ambiguous: [] },
      '/vault/Projects',
    );
    expect(bindings).toEqual([
      {
        id: 'auto-p1',
        filePath: '/vault/Projects/Alpha/backlog.md',
        projectId: 'p1',
        enabled: true,
        projectTitle: 'Alpha',
      },
    ]);
  });

  it('does not create bindings for unmatched or ambiguous folders', () => {
    const bindings = bindingsFromMatches(
      { matched: [], foldersWithoutProject: ['New'], projectsWithoutFolder: [], ambiguous: ['Dup'] },
      '/vault/Projects',
    );
    expect(bindings).toEqual([]);
  });

  it('tolerates a trailing separator on the projects folder', () => {
    const [b] = bindingsFromMatches(
      { matched: [{ folder: 'A', projectId: 'p' }], foldersWithoutProject: [], projectsWithoutFolder: [], ambiguous: [] },
      '/vault/Projects/',
    );
    expect(b.filePath).toBe('/vault/Projects/A/backlog.md');
  });
});

describe('bindingsFromMatches with a custom task file name', () => {
  it('points each matched folder at the configured file name', () => {
    const [b] = bindingsFromMatches(
      { matched: [{ folder: 'Alpha', projectId: 'p1' }], foldersWithoutProject: [], projectsWithoutFolder: [], ambiguous: [] },
      '/vault/Projects',
      {},
      'tasks.md',
    );
    expect(b.filePath).toBe('/vault/Projects/Alpha/tasks.md');
  });
});

describe('bindingsFromMatches with manual binds', () => {
  it('uses a bound markdown file as-is instead of appending backlog.md', () => {
    const [b] = bindingsFromMatches(
      { matched: [{ folder: 'Inbox/notes.md', projectId: 'p1' }], foldersWithoutProject: [], projectsWithoutFolder: [], ambiguous: [] },
      '/vault/Projects',
      { p1: 'Alpha' },
    );
    expect(b.filePath).toBe('/vault/Projects/Inbox/notes.md');
    expect(b.projectTitle).toBe('Alpha');
  });
});
