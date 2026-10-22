import {
  matchFoldersToProjects,
  validFolderName,
  validBindFile,
  resolveProjectsDirCfg,
  validateProjectsDirCfg,
  DEFAULT_PROJECTS_DIR_CFG,
} from '../project-dir';

const P = (id: string, title: string) => ({ id, title });

describe('validateProjectsDirCfg', () => {
  it('defaults to OFF with the Projects folder', () => {
    expect(DEFAULT_PROJECTS_DIR_CFG).toMatchObject({ enabled: false, projectsDir: 'Projects', taskFileName: 'backlog.md' });
  });

  it('accepts a relative folder and trims excluded names', () => {
    const r = validateProjectsDirCfg({ projectsDir: 'Projects/', excluded: [' Old ', 'Old', ''] });
    expect(r).toEqual({
      ok: true,
      cfg: {
        enabled: false,
        projectsDir: 'Projects',
        excluded: ['Old'],
        folderBinds: {},
        taskFileName: 'backlog.md',
        confirmFolderDelete: false,
        excludeRemovedProjects: false,
      },
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

  it('trims the task file name and keeps a custom one', () => {
    const r = validateProjectsDirCfg({ taskFileName: '  tasks.md ' });
    expect(r.ok && r.cfg.taskFileName).toBe('tasks.md');
  });

  it('rejects an empty task file name', () => {
    expect(validateProjectsDirCfg({ taskFileName: '  ' })).toEqual({
      ok: false,
      error: 'Task file name is required.',
    });
  });

  it('rejects a task file name that is not a markdown file or has folders', () => {
    for (const bad of ['tasks.txt', 'sub/tasks.md', '../tasks.md', '..', 'tasks']) {
      expect(validateProjectsDirCfg({ taskFileName: bad }).ok).toBe(false);
    }
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

describe('validFolderName', () => {
  it('accepts a plain name', () => {
    expect(validFolderName('Neues Projekt')).toBe(true);
  });

  it('rejects separators, traversal and empty names', () => {
    expect(validFolderName('a/b')).toBe(false);
    expect(validFolderName('..')).toBe(false);
    expect(validFolderName('')).toBe(false);
  });
});

describe('manual folder binds', () => {
  it('pairs a bound folder with its chosen project even when titles differ', () => {
    const r = matchFoldersToProjects(['Inbox/backlog.md'], [{ id: 'p1', title: 'Alpha' }], [], {
      'Inbox/backlog.md': 'p1',
    });
    expect(r.matched).toEqual([{ folder: 'Inbox/backlog.md', projectId: 'p1' }]);
    expect(r.projectsWithoutFolder).toEqual([]);
  });

  it('a manual bind wins over a same-title match', () => {
    const r = matchFoldersToProjects(
      ['Alpha', 'Other'],
      [{ id: 'p1', title: 'Alpha' }, { id: 'p2', title: 'Other' }],
      [],
      { Alpha: 'p2' },
    );
    expect(r.matched).toEqual(expect.arrayContaining([
      { folder: 'Alpha', projectId: 'p2' },
    ]));
    expect(r.matched.find((m) => m.projectId === 'p1')).toBeUndefined();
  });

  it('ignores a bind whose folder or project no longer exists', () => {
    const r = matchFoldersToProjects([], [{ id: 'p1', title: 'Alpha' }], [], { gone: 'p1' });
    expect(r.matched).toEqual([]);
    expect(r.projectsWithoutFolder).toEqual([{ id: 'p1', title: 'Alpha' }]);
  });

  it('a bind does not apply to an excluded folder', () => {
    const r = matchFoldersToProjects(['X'], [{ id: 'p1', title: 'Alpha' }], ['X'], { X: 'p1' });
    expect(r.matched).toEqual([]);
  });
});

describe('validBindFile', () => {
  it('accepts a relative markdown file', () => {
    expect(validBindFile('Inbox/backlog.md')).toBe(true);
  });

  it('rejects absolute paths, traversal and non-markdown files', () => {
    expect(validBindFile('/etc/x.md')).toBe(false);
    expect(validBindFile('../x.md')).toBe(false);
    expect(validBindFile('Inbox/notes.txt')).toBe(false);
    expect(validBindFile('')).toBe(false);
  });
});
