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
  titles: Record<string, string> = {},
): SyncBindingCfg[] => {
  const base = projectsDirAbs.replace(/[\\/]+$/, '');
  return match.matched.map(({ folder, projectId }) => {
    // A manual bind points at a markdown file; a folder match points at its backlog.md.
    const isFile = /\.md$/i.test(folder);
    return {
      id: `auto-${projectId}`,
      filePath: isFile ? `${base}/${folder}` : `${base}/${folder}/backlog.md`,
      projectId,
      enabled: true,
      projectTitle: titles[projectId] ?? folder,
    };
  });
};
