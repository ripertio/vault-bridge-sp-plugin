import { computeEffectiveBindings } from '../effective-bindings';
import { DEFAULT_PROJECTS_DIR_CFG } from '../project-dir';

const manual = [{ id: 'm1', filePath: '/x/manual.md', projectId: 'p9', enabled: true }];
const on = { ...DEFAULT_PROJECTS_DIR_CFG, enabled: true };
const deps = (folders: string[] | Error, projects = [{ id: 'p1', title: 'Alpha' }]) => ({
  listFolders: jest.fn(async () => {
    if (folders instanceof Error) throw folders;
    return folders;
  }),
  getProjects: jest.fn(async () => projects),
});

describe('computeEffectiveBindings', () => {
  it('returns the manual list unchanged when auto mode is off', async () => {
    const d = deps(['Alpha']);
    const r = await computeEffectiveBindings(manual, DEFAULT_PROJECTS_DIR_CFG, '/vault', d);
    expect(r).toEqual({ ok: true, bindings: manual });
    expect(d.listFolders).not.toHaveBeenCalled();
  });

  it('replaces the manual list with folder-derived bindings when auto mode is on', async () => {
    const r = await computeEffectiveBindings(manual, on, '/vault', deps(['Alpha']));
    expect(r.ok && r.bindings.map((b) => b.projectId)).toEqual(['p1']);
    expect(r.ok && r.bindings[0].filePath).toBe('/vault/Projects/Alpha/backlog.md');
  });

  it('runs nothing (does not fall back to manual) when the folder scan fails', async () => {
    const r = await computeEffectiveBindings(manual, on, '/vault', deps(new Error('EACCES')));
    expect(r).toEqual({ ok: false, error: 'EACCES' });
  });

  it('requires a vault path in auto mode', async () => {
    const r = await computeEffectiveBindings(manual, on, '', deps([]));
    expect(r.ok).toBe(false);
  });
});
