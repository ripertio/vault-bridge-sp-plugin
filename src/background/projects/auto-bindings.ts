import type { SyncBindingCfg } from '../local-config';
import { FolderMatchResult } from './project-dir';

/**
 * Build the sync bindings for auto mode: one binding per matched folder, pointing
 * at `<projectsDirAbs>/<folder>/<taskFileName>`. The ID is stable per project so that
 * _lastSynced and the existing per-file sync state keep working across restarts.
 * Pure: no I/O.
 */
export const bindingsFromMatches = (
  match: FolderMatchResult,
  projectsDirAbs: string,
  titles: Record<string, string> = {},
  taskFileName = 'backlog.md',
  // Folder name → the .md files inside it. Only given when every file is synced.
  filesByFolder: Record<string, string[]> = {},
): SyncBindingCfg[] => {
  const base = projectsDirAbs.replace(/[\\/]+$/, '');
  return match.matched.flatMap(({ folder, projectId }) => {
    // A manual bind points at a markdown file; a folder match points at its task file.
    const isFile = /\.md$/i.test(folder);
    const mainPath = isFile ? `${base}/${folder}` : `${base}/${folder}/${taskFileName}`;
    const main: SyncBindingCfg = {
      id: `auto-${projectId}`,
      filePath: mainPath,
      projectId,
      enabled: true,
      projectTitle: titles[projectId] ?? folder,
    };
    const extras = isFile
      ? []
      : (filesByFolder[folder] ?? []).filter((name) => name.toLowerCase() !== taskFileName.toLowerCase());
    if (extras.length === 0) return [main];
    const groupPaths = [mainPath, ...extras.map((name) => `${base}/${folder}/${name}`)];
    return [
      { ...main, groupPaths },
      ...extras.map((name, i) => ({
        id: `auto-${projectId}::${name}`,
        filePath: groupPaths[i + 1],
        projectId,
        enabled: true,
        projectTitle: titles[projectId] ?? folder,
        groupPaths,
      })),
    ];
  });
};
