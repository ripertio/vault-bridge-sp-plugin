import type { SyncBindingCfg } from '../local-config';
import { FolderMatchResult } from './project-dir';

/**
 * Build the sync bindings for auto mode: one binding per matched folder, pointing
 * at `<projectsDirAbs>/<folder>/backlog.md`. The ID is stable per project so that
 * _lastSynced and the existing per-file sync state keep working across restarts.
 * Pure: no I/O.
 */
export const bindingsFromMatches = (
  match: FolderMatchResult,
  projectsDirAbs: string,
): SyncBindingCfg[] => {
  const base = projectsDirAbs.replace(/[\\/]+$/, '');
  return match.matched.map(({ folder, projectId }) => ({
    id: `auto-${projectId}`,
    filePath: `${base}/${folder}/backlog.md`,
    projectId,
    enabled: true,
    projectTitle: folder,
  }));
};
