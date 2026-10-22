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

  it('treats a save without bindings as an empty list, not as a reason to drop state', () => {
    const merged = mergeUiConfig(current, undefined);
    expect(merged.bindings).toEqual([]);
    expect(merged._projectLinks).toEqual({ p1: 'Sync Files SP' });
  });
});
