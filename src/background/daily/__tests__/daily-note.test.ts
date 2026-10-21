import {
  DEFAULT_DAILY_NOTE_CFG,
  dailyNoteRelativePath,
  ensureToDosSection,
  findToDosSection,
  formatDailyFilename,
  plannedTaskIdsForToday,
  resolveDailyNoteCfg,
  resolveInsideVault,
} from '../daily-note';

const OCT_21 = new Date(2026, 9, 21);

describe('daily note defaults', () => {
  it('are OFF and dry-run', () => {
    expect(DEFAULT_DAILY_NOTE_CFG.enabled).toBe(false);
    expect(DEFAULT_DAILY_NOTE_CFG.dryRun).toBe(true);
  });
});

describe('formatDailyFilename', () => {
  it('replaces YYYY, MM and DD with zero-padded local date parts', () => {
    expect(formatDailyFilename('YYYY-MM-DD', OCT_21)).toBe('2026-10-21');
    expect(formatDailyFilename('YYYY-MM-DD', new Date(2026, 0, 5))).toBe('2026-01-05');
  });

  it('keeps other text as-is', () => {
    expect(formatDailyFilename('Daily YYYY', OCT_21)).toBe('Daily 2026');
  });
});

describe('dailyNoteRelativePath', () => {
  it('joins the folder and formatted filename', () => {
    expect(dailyNoteRelativePath(DEFAULT_DAILY_NOTE_CFG, OCT_21)).toBe('Daily/2026-10-21.md');
  });

  it('trims surrounding slashes and normalizes backslashes', () => {
    const cfg = { ...DEFAULT_DAILY_NOTE_CFG, folder: '/Notes\\Daily/' };
    expect(dailyNoteRelativePath(cfg, OCT_21)).toBe('Notes/Daily/2026-10-21.md');
  });

  it('allows an empty folder meaning the vault root', () => {
    const cfg = { ...DEFAULT_DAILY_NOTE_CFG, folder: '' };
    expect(dailyNoteRelativePath(cfg, OCT_21)).toBe('2026-10-21.md');
  });

  it('rejects folders that escape the vault root', () => {
    const cfg = { ...DEFAULT_DAILY_NOTE_CFG, folder: '../outside' };
    expect(() => dailyNoteRelativePath(cfg, OCT_21)).toThrow();
  });

  it('rejects filename formats that contain a separator or traversal', () => {
    expect(() =>
      dailyNoteRelativePath({ ...DEFAULT_DAILY_NOTE_CFG, filenameFormat: 'x/YYYY' }, OCT_21),
    ).toThrow();
    expect(() =>
      dailyNoteRelativePath({ ...DEFAULT_DAILY_NOTE_CFG, filenameFormat: '..' }, OCT_21),
    ).toThrow();
  });
});

describe('plannedTaskIdsForToday', () => {
  it('returns the taskIds of the TODAY tag', () => {
    const tags = [
      { id: 'OTHER', taskIds: ['x'] },
      { id: 'TODAY', taskIds: ['a', 'b'] },
    ];
    expect(plannedTaskIdsForToday(tags)).toEqual(['a', 'b']);
  });

  it('returns an empty list when the TODAY tag is missing', () => {
    expect(plannedTaskIdsForToday([{ id: 'OTHER', taskIds: ['x'] }])).toEqual([]);
  });

  it('does not alias the source array', () => {
    const tags = [{ id: 'TODAY', taskIds: ['a'] }];
    plannedTaskIdsForToday(tags).push('mutated');
    expect(tags[0].taskIds).toEqual(['a']);
  });
});

describe('findToDosSection', () => {
  it('returns null when the heading is absent', () => {
    expect(findToDosSection(['# Day', 'text'])).toBeNull();
  });

  it('finds the body up to the next ## heading', () => {
    const lines = ['# Day', '## To Dos', '- [ ] a', '- [ ] b', '## Notes', 'x'];
    expect(findToDosSection(lines)).toEqual({ headingIndex: 1, bodyStart: 2, bodyEnd: 4 });
  });

  it('runs to end of file when no later heading exists', () => {
    const lines = ['## To Dos', '- [ ] a'];
    expect(findToDosSection(lines)).toEqual({ headingIndex: 0, bodyStart: 1, bodyEnd: 2 });
  });
});

describe('ensureToDosSection', () => {
  it('appends the heading and keeps existing content untouched', () => {
    const lines = ['# 2026-10-21', 'Some note'];
    expect(ensureToDosSection(lines)).toEqual(['# 2026-10-21', 'Some note', '', '## To Dos']);
  });

  it('does not duplicate an existing heading', () => {
    const lines = ['## To Dos', '- [ ] a'];
    expect(ensureToDosSection(lines)).toEqual(lines);
  });

  it('does not mutate the input array', () => {
    const lines = ['# Day'];
    ensureToDosSection(lines);
    expect(lines).toEqual(['# Day']);
  });
});

describe('resolveDailyNoteCfg', () => {
  it('returns the safe defaults when nothing is stored', () => {
    expect(resolveDailyNoteCfg(undefined)).toEqual(DEFAULT_DAILY_NOTE_CFG);
  });

  it('keeps stored values and fills the rest from defaults', () => {
    const cfg = resolveDailyNoteCfg({ enabled: true, folder: 'Journal' });
    expect(cfg).toEqual({ ...DEFAULT_DAILY_NOTE_CFG, enabled: true, folder: 'Journal' });
    expect(cfg.dryRun).toBe(true);
  });
});

describe('resolveInsideVault', () => {
  it('joins the vault root and relative path', () => {
    expect(resolveInsideVault('/vault/', 'Daily/2026-10-21.md')).toBe('/vault/Daily/2026-10-21.md');
  });

  it('rejects a relative vault root', () => {
    expect(() => resolveInsideVault('vault', 'Daily/x.md')).toThrow();
  });

  it('rejects traversal and absolute relative paths', () => {
    expect(() => resolveInsideVault('/vault', '../etc/x.md')).toThrow();
    expect(() => resolveInsideVault('/vault', '/etc/passwd')).toThrow();
  });
});

describe('resolveDailyNoteCfg vault migration', () => {
  it('reads a legacy vaultRoot as vaultPath', () => {
    const cfg = resolveDailyNoteCfg({ enabled: true, vaultRoot: '/legacy' } as any);
    expect(cfg.vaultPath).toBe('/legacy');
  });

  it('prefers vaultPath when both exist', () => {
    const cfg = resolveDailyNoteCfg({ vaultPath: '/new', vaultRoot: '/legacy' } as any);
    expect(cfg.vaultPath).toBe('/new');
  });
});
