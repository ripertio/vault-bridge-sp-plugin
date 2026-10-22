import { mergeUiConfig, LocalUserCfgV2 } from '../local-config';

const current: LocalUserCfgV2 = {
  version: 2,
  bindings: [{ id: 'a', filePath: '/v/a.md', projectId: 'p1', enabled: true }],
  vaultPath: '/v',
  _projectLinks: { p1: 'Sync Files SP' },
  _knownFolders: ['Sync Files SP'],
  _unlinkedProjectIds: ['p2'],
  _lastSynced: { a: '2026-10-22T00:00:00.000Z' },
  projectsDir: { enabled: true, projectsDir: 'Projects', excluded: [], taskFileName: 'backlog.md', confirmFolderDelete: false, excludeRemovedProjects: false },
};

describe('mergeUiConfig', () => {
  it('takes bindings and version from the panel', () => {
    const merged = mergeUiConfig(current, { version: 2, bindings: [] });
    expect(merged.bindings).toEqual([]);
    expect(merged.version).toBe(2);
  });

  it('keeps the links, folder state and vault path a panel save does not send', () => {
    const merged = mergeUiConfig(current, { version: 2, bindings: [] });
    expect(merged._projectLinks).toEqual({ p1: 'Sync Files SP' });
    expect(merged._knownFolders).toEqual(['Sync Files SP']);
    expect(merged._unlinkedProjectIds).toEqual(['p2']);
    expect(merged.vaultPath).toBe('/v');
    expect(merged._lastSynced).toEqual(current._lastSynced);
    expect(merged.projectsDir).toEqual(current.projectsDir);
  });

  it('keeps the current bindings when the save has no bindings list', () => {
    const merged = mergeUiConfig(current, undefined);
    expect(merged.bindings).toEqual(current.bindings);
    expect(merged._projectLinks).toEqual({ p1: 'Sync Files SP' });
  });

  it('keeps the current bindings when a partial save omits them', () => {
    const merged = mergeUiConfig(current, { version: 2 });
    expect(merged.bindings).toEqual(current.bindings);
  });

  it('clears the bindings when the panel sends an empty list', () => {
    expect(mergeUiConfig(current, { version: 2, bindings: [] }).bindings).toEqual([]);
  });

  it('does not bring back a binding whose project already has a folder bind', () => {
    const withFolderBind: LocalUserCfgV2 = {
      ...current,
      projectsDir: { ...current.projectsDir, folderBinds: { 'Inbox/backlog.md': 'p1' } },
    };
    const stale = [
      { id: 'a', filePath: '/v/Projects/Inbox/backlog.md', projectId: 'p1', enabled: true },
      { id: 'b', filePath: '/v/other.md', projectId: 'p3', enabled: true },
    ];
    const merged = mergeUiConfig(withFolderBind, { version: 2, bindings: stale });
    expect(merged.bindings).toEqual([stale[1]]);
  });
});
