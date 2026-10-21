import { DailyNoteCfg, DEFAULT_DAILY_NOTE_CFG, resolveInsideVault, dailyNoteRelativePath } from './daily-note';

export type DailySettingsResult =
  | { ok: true; cfg: DailyNoteCfg }
  | { ok: false; error: string };

const isAbsolute = (p: string): boolean => p.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(p);

/**
 * Validate user-entered daily-note settings before they are saved. Only the
 * settings are checked; the vault is never read here. Returns the normalized
 * config or an error the panel can show.
 */
export const validateDailySettings = (input: Partial<DailyNoteCfg>): DailySettingsResult => {
  const cfg: DailyNoteCfg = { ...DEFAULT_DAILY_NOTE_CFG, ...input };
  const vaultRoot = (cfg.vaultRoot ?? '').trim().replace(/[\\/]+$/, '');
  const folder = (cfg.folder ?? '').trim();
  const format = (cfg.filenameFormat ?? '').trim();

  if (cfg.enabled) {
    if (!vaultRoot) return { ok: false, error: 'Vault folder is required.' };
    if (!isAbsolute(vaultRoot)) return { ok: false, error: 'Vault folder must be an absolute path.' };
    if (vaultRoot.split(/[\\/]/).includes('..')) return { ok: false, error: 'Vault folder must not contain "..".' };
  }
  if (folder && folder.split(/[\\/]/).some((s) => s === '..')) {
    return { ok: false, error: 'Daily folder must stay inside the vault.' };
  }
  if (isAbsolute(folder)) {
    return { ok: false, error: 'Daily folder must be relative to the vault.' };
  }
  if (!format) return { ok: false, error: 'Filename format is required.' };

  const normalized: DailyNoteCfg = { ...cfg, vaultRoot, folder, filenameFormat: format };

  // Build a sample path to run the same checks the runner will run.
  try {
    const sample = dailyNoteRelativePath(normalized, new Date());
    if (cfg.enabled) resolveInsideVault(vaultRoot, sample);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Invalid daily note path.' };
  }

  return { ok: true, cfg: normalized };
};
