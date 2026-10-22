import { assertRealPathInside, listExistingFiles, listSubfolders } from '../helper/file-utils';
import { validBindFile } from './project-dir';

// Manual binds to a .md file in the projects folder (for example "Inbox/backlog.md").
// Only binds whose file exists, and whose real path stays in the vault, take part in matching.
export const boundFilesPresent = async (
  vault: string,
  absDir: string,
  binds: Record<string, string>,
): Promise<string[]> => {
  const rels = Object.keys(binds).filter((k) => validBindFile(k));
  if (rels.length === 0) return [];
  const present: string[] = [];
  for (const rel of await listExistingFiles(absDir, rels)) {
    try {
      await assertRealPathInside(vault, `${absDir}/${rel}`);
      present.push(rel);
    } catch {
      // Outside the vault: not matched.
    }
  }
  return present;
};

// Everything the projects folder can bind: its sub-folders and the bound .md files that
// exist. Every caller that matches or compares the folder uses this one list, so a bound
// file is never dropped by one path and kept by another.
export const listProjectEntries = async (
  vault: string,
  absDir: string,
  binds: Record<string, string>,
): Promise<string[]> => [...(await listSubfolders(absDir)), ...(await boundFilesPresent(vault, absDir, binds))];
