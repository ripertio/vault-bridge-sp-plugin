import type { SyncBindingCfg } from '../local-config';

export interface MigrationResult {
  // folder path (relative to the projects folder) → project id, for folder binds.
  folderBinds: Record<string, string>;
  // Bindings whose file is outside the projects folder: cannot be a folder bind.
  kept: SyncBindingCfg[];
}

/**
 * Turn each saved manual binding into a folder bind when its file lies inside the
 * projects folder. A binding outside that folder is returned in `kept` and is not
 * dropped, so the user still sees it. Pure: no I/O.
 */
export const migrateManualBindings = (
  bindings: SyncBindingCfg[],
  projectsDirAbs: string,
): MigrationResult => {
  const base = projectsDirAbs.replace(/[\\/]+$/, '').replace(/\\/g, '/');
  const folderBinds: Record<string, string> = {};
  const kept: SyncBindingCfg[] = [];

  for (const b of bindings) {
    if (!b.enabled || !b.filePath || !b.projectId) continue;
    const file = b.filePath.replace(/\\/g, '/');
    if (file.startsWith(base + '/') && /\.md$/i.test(file)) {
      const rel = file.slice(base.length + 1);
      if (rel.split('/').some((seg) => seg === '..' || seg === '')) {
        kept.push(b);
        continue;
      }
      // One project maps to one file; keep the first, report the rest.
      if (Object.values(folderBinds).includes(b.projectId)) {
        kept.push(b);
      } else {
        folderBinds[rel] = b.projectId;
      }
    } else {
      kept.push(b);
    }
  }
  return { folderBinds, kept };
};
