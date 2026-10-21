import type { LocalUserCfgV2 } from './local-config';

export type VaultValidation = { ok: true; path: string } | { ok: false; error: string };

const isAbsolute = (p: string): boolean => p.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(p);

/**
 * Validate the vault path, stored once for the whole plugin. An empty path is
 * allowed (the vault is not configured yet); daily notes and project folders
 * check for it when they run.
 */
export const validateVaultPath = (input: string | undefined): VaultValidation => {
  const path = (input ?? '').trim().replace(/[\\/]+$/, '');
  if (!path) return { ok: true, path: '' };
  if (!isAbsolute(path)) return { ok: false, error: 'Vault path must be an absolute path.' };
  if (path.split(/[\\/]/).includes('..')) return { ok: false, error: 'Vault path must not contain "..".' };
  return { ok: true, path };
};

/**
 * The vault path to use. The top-level `vaultPath` wins. Older configs stored it
 * inside `daily.vaultPath`, so that is the fallback.
 */
export const effectiveVaultPath = (config: Pick<LocalUserCfgV2, 'vaultPath' | 'daily'>): string =>
  config.vaultPath ?? config.daily?.vaultPath ?? '';
