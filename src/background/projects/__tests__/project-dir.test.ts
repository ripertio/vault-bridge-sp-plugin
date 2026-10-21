import {
  matchFoldersToProjects,
  resolveProjectsDirCfg,
  validateProjectsDirCfg,
  DEFAULT_PROJECTS_DIR_CFG,
} from '../project-dir';

const P = (id: string, title: string) => ({ id, title });

describe('validateProjectsDirCfg', () => {
  it('defaults to OFF with the Projects folder', () => {
    expect(DEFAULT_PROJECTS_DIR_CFG).toMatchObject({ enabled: false, projectsDir: 'Projects' });
  });

  it('accepts a relative folder and trims excluded names', () => {
    const r = validateProjectsDirCfg({ projectsDir: 'Projects/', excluded: [' Old ', 'Old', ''] });
    expect(r).toEqual({
      ok: true,
      cfg: { enabled: false, projectsDir: 'Projects', excluded: ['Old'] },
    });
  });

  it('rejects an absolute projects folder', () => {
    expect(validateProjectsDirCfg({ projectsDir: '/abs' })).toEqual({
      ok: false,
      error: 'Projects folder must be relative to the vault path.',
    });
  });

  it('rejects traversal', () => {
    expect(validateProjectsDirCfg({ projectsDir: '../x' }).ok).toBe(false);
  });

  it('requires a projects folder', () => {
    expect(validateProjectsDirCfg({ projectsDir: '  ' }).ok).toBe(false);
  });

  it('resolves missing fields over defaults', () => {
    expect(resolveProjectsDirCfg(undefined)).toEqual(DEFAULT_PROJECTS_DIR_CFG);
  });
});

describe('matchFoldersToProjects', () => {
  it('matches a folder to a project with the exact same title', () => {
    const r = matchFoldersToProjects(['Alpha'], [P('p1', 'Alpha')], []);
    expect(r.matched).toEqual([{ folder: 'Alpha', projectId: 'p1' }]);
  });

  it('does not match when the case differs (exact matching)', () => {
    const r = matchFoldersToProjects(['alpha'], [P('p1', 'Alpha')], []);
    expect(r.matched).toEqual([]);
    expect(r.foldersWithoutProject).toEqual(['alpha']);
    expect(r.projectsWithoutFolder).toEqual([P('p1', 'Alpha')]);
  });

  it('reports a folder with no project as a creation candidate', () => {
    const r = matchFoldersToProjects(['New'], [], []);
    expect(r.foldersWithoutProject).toEqual(['New']);
  });

  it('reports a project with no folder as a folder-creation candidate', () => {
    const r = matchFoldersToProjects([], [P('p1', 'Beta')], []);
    expect(r.projectsWithoutFolder).toEqual([P('p1', 'Beta')]);
  });

  it('never treats the Inbox as a project folder', () => {
    const r = matchFoldersToProjects([], [P('INBOX_PROJECT', 'Inbox')], []);
    expect(r.projectsWithoutFolder).toEqual([]);
  });

  it('skips excluded names on both sides', () => {
    const r = matchFoldersToProjects(['Skip'], [P('p1', 'Skip'), P('p2', 'Keep')], ['Skip']);
    expect(r.matched).toEqual([]);
    expect(r.foldersWithoutProject).toEqual([]);
    expect(r.projectsWithoutFolder).toEqual([P('p2', 'Keep')]);
  });

  it('flags a title shared by two projects as ambiguous and never matches it', () => {
    const r = matchFoldersToProjects(['Dup'], [P('p1', 'Dup'), P('p2', 'Dup')], []);
    expect(r.ambiguous).toEqual(['Dup']);
    expect(r.matched).toEqual([]);
  });

  it('ignores duplicate folder names', () => {
    const r = matchFoldersToProjects(['A', 'A'], [P('p1', 'A')], []);
    expect(r.matched).toHaveLength(1);
  });
});
