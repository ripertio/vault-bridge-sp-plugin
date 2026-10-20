import { canonicalizePathKey } from '../../helper/path-utils';

/**
 * Unit tests for the lexical path canonicalizer used to detect two bindings
 * targeting one physical file (super-productivity#9323 second review, point 3).
 */
describe('canonicalizePathKey', () => {
  it('collapses a `.` segment (the cited duplicate case)', () => {
    expect(canonicalizePathKey('/tmp/./tasks.md')).toBe(
      canonicalizePathKey('/tmp/tasks.md'),
    );
    expect(canonicalizePathKey('/tmp/tasks.md')).toBe('/tmp/tasks.md');
  });

  it('resolves `..` segments', () => {
    expect(canonicalizePathKey('/a/b/../tasks.md')).toBe('/a/tasks.md');
    expect(canonicalizePathKey('/a/b/c/../../tasks.md')).toBe('/a/tasks.md');
  });

  it('collapses duplicate and trailing separators', () => {
    expect(canonicalizePathKey('/tmp//sub///tasks.md')).toBe('/tmp/sub/tasks.md');
    expect(canonicalizePathKey('/tmp/sub/')).toBe('/tmp/sub');
  });

  it('does not go above an absolute root with `..`', () => {
    expect(canonicalizePathKey('/../../tasks.md')).toBe('/tasks.md');
  });

  it('keeps leading `..` for relative paths (cannot resolve lexically)', () => {
    expect(canonicalizePathKey('../a/tasks.md')).toBe('../a/tasks.md');
    expect(canonicalizePathKey('a/../b/tasks.md')).toBe('b/tasks.md');
  });

  it('preserves case (Linux is case-sensitive)', () => {
    expect(canonicalizePathKey('/tmp/Tasks.md')).not.toBe(
      canonicalizePathKey('/tmp/tasks.md'),
    );
  });

  it('unifies Windows separators and upper-cases the drive letter', () => {
    expect(canonicalizePathKey('c:\\Users\\me\\tasks.md')).toBe(
      canonicalizePathKey('C:/Users/me/tasks.md'),
    );
    expect(canonicalizePathKey('C:\\a\\.\\b\\..\\tasks.md')).toBe('C:/a/tasks.md');
  });

  it('returns falsy input unchanged', () => {
    expect(canonicalizePathKey('')).toBe('');
  });
});
