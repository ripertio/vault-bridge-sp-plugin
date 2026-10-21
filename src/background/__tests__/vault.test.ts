import { validateVaultPath, effectiveVaultPath } from '../vault';

describe('validateVaultPath', () => {
  it('accepts an absolute path and trims trailing separators', () => {
    expect(validateVaultPath('/Users/me/Vault/')).toEqual({ ok: true, path: '/Users/me/Vault' });
  });

  it('allows an empty path (not configured yet)', () => {
    expect(validateVaultPath('  ')).toEqual({ ok: true, path: '' });
  });

  it('rejects a relative path', () => {
    expect(validateVaultPath('Vault').ok).toBe(false);
  });

  it('rejects traversal', () => {
    expect(validateVaultPath('/a/../b').ok).toBe(false);
  });
});

describe('effectiveVaultPath', () => {
  it('prefers the top-level vault path', () => {
    expect(effectiveVaultPath({ vaultPath: '/new', daily: { vaultPath: '/old' } })).toBe('/new');
  });

  it('falls back to the legacy daily.vaultPath', () => {
    expect(effectiveVaultPath({ daily: { vaultPath: '/old' } })).toBe('/old');
  });

  it('is empty when nothing is set', () => {
    expect(effectiveVaultPath({})).toBe('');
  });
});
