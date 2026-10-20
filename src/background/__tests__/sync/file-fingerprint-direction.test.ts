import { hashContent } from '../../helper/hash';
import { fileHasUnsyncedEdit } from '../../sync/sync-manager';

/**
 * Point 4 (super-productivity#9323 second review): Sync Now must pick its
 * direction from a CONTENT fingerprint, not the filesystem mtime. These tests
 * cover the two pure pieces: the fingerprint and the direction decision.
 */
describe('hashContent (content fingerprint)', () => {
  it('is deterministic for identical content', () => {
    expect(hashContent('- [ ] task')).toBe(hashContent('- [ ] task'));
  });

  it('changes when the content changes', () => {
    expect(hashContent('- [ ] task')).not.toBe(hashContent('- [x] task'));
    // A single appended line is a different fingerprint.
    expect(hashContent('a\nb')).not.toBe(hashContent('a\nb\nc'));
  });

  it('distinguishes whitespace-only differences', () => {
    expect(hashContent('- [ ] task')).not.toBe(hashContent('- [ ]  task'));
    expect(hashContent('a\nb')).not.toBe(hashContent('a\nb\n'));
  });

  it('handles empty content', () => {
    expect(hashContent('')).toBe(hashContent(''));
    expect(hashContent('')).not.toBe(hashContent(' '));
  });
});

describe('fileHasUnsyncedEdit (direction decision)', () => {
  it('treats a null baseline as changed (never synced / file was unreadable)', () => {
    expect(fileHasUnsyncedEdit('abc', null)).toBe(true);
    expect(fileHasUnsyncedEdit(null, null)).toBe(true);
  });

  it('is "changed" when the current hash differs from the baseline', () => {
    const baseline = hashContent('a');
    const edited = hashContent('a\nb');
    expect(fileHasUnsyncedEdit(edited, baseline)).toBe(true);
  });

  it('is "unchanged" when the hashes match (regardless of mtime — not an input)', () => {
    const baseline = hashContent('a\nb');
    const current = hashContent('a\nb');
    expect(fileHasUnsyncedEdit(current, baseline)).toBe(false);
  });
});
