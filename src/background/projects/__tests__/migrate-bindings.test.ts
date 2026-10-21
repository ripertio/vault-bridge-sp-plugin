import { migrateManualBindings } from '../migrate-bindings';

const b = (id: string, filePath: string, projectId: string, enabled = true) => ({
  id,
  filePath,
  projectId,
  enabled,
});

describe('migrateManualBindings', () => {
  it('turns a binding inside the projects folder into a folder bind', () => {
    const r = migrateManualBindings([b('1', '/v/Projects/Inbox/backlog.md', 'p1')], '/v/Projects');
    expect(r.folderBinds).toEqual({ 'Inbox/backlog.md': 'p1' });
    expect(r.kept).toEqual([]);
  });

  it('keeps a binding outside the projects folder (not dropped)', () => {
    const outside = b('2', '/elsewhere/tasks.md', 'p2');
    const r = migrateManualBindings([outside], '/v/Projects');
    expect(r.folderBinds).toEqual({});
    expect(r.kept).toEqual([outside]);
  });

  it('skips disabled bindings', () => {
    const r = migrateManualBindings([b('3', '/v/Projects/A/backlog.md', 'p3', false)], '/v/Projects');
    expect(r).toEqual({ folderBinds: {}, kept: [] });
  });

  it('keeps a second binding for the same project instead of overwriting', () => {
    const second = b('5', '/v/Projects/B/backlog.md', 'p4');
    const r = migrateManualBindings(
      [b('4', '/v/Projects/A/backlog.md', 'p4'), second],
      '/v/Projects',
    );
    expect(r.folderBinds).toEqual({ 'A/backlog.md': 'p4' });
    expect(r.kept).toEqual([second]);
  });

  it('does not migrate a non-markdown file', () => {
    const txt = b('6', '/v/Projects/A/notes.txt', 'p5');
    const r = migrateManualBindings([txt], '/v/Projects');
    expect(r.kept).toEqual([txt]);
  });
});
