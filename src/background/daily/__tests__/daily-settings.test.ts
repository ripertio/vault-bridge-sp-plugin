import { validateDailySettings } from '../daily-settings';

const base = { enabled: true, vaultPath: '/Users/me/Vault', folder: 'Daily', filenameFormat: 'YYYY-MM-DD' };

describe('validateDailySettings', () => {
  it('accepts a complete setting and normalizes the vault path', () => {
    const r = validateDailySettings({ ...base, vaultPath: '/Users/me/Vault/' });
    expect(r).toMatchObject({ ok: true, cfg: { vaultPath: '/Users/me/Vault', folder: 'Daily' } });
  });

  it('requires a vault folder when enabled', () => {
    expect(validateDailySettings({ ...base, vaultPath: '' })).toEqual({
      ok: false,
      error: 'Vault path is required.',
    });
  });

  it('does not require a vault folder when disabled', () => {
    expect(validateDailySettings({ ...base, enabled: false, vaultPath: '' }).ok).toBe(true);
  });

  it('rejects a relative vault folder', () => {
    expect(validateDailySettings({ ...base, vaultPath: 'Vault' })).toEqual({
      ok: false,
      error: 'Vault path must be an absolute path.',
    });
  });

  it('rejects ".." in the vault folder', () => {
    expect(validateDailySettings({ ...base, vaultPath: '/a/../b' }).ok).toBe(false);
  });

  it('rejects a daily folder that escapes the vault', () => {
    expect(validateDailySettings({ ...base, folder: '../outside' })).toEqual({
      ok: false,
      error: 'Daily folder must stay inside the vault.',
    });
  });

  it('rejects an absolute daily folder', () => {
    expect(validateDailySettings({ ...base, folder: '/etc' })).toEqual({
      ok: false,
      error: 'Daily folder must be relative to the vault.',
    });
  });

  it('requires a filename format', () => {
    expect(validateDailySettings({ ...base, filenameFormat: '  ' })).toEqual({
      ok: false,
      error: 'Filename format is required.',
    });
  });

  it('rejects a filename format with a path separator', () => {
    expect(validateDailySettings({ ...base, filenameFormat: 'a/YYYY' }).ok).toBe(false);
  });

  it('keeps the enabled flags as given (defaults stay OFF when not provided)', () => {
    const r = validateDailySettings({ vaultPath: '/v' });
    expect(r).toMatchObject({ ok: true, cfg: { enabled: false, dryRun: true, deleteRemoved: false } });
  });
});
