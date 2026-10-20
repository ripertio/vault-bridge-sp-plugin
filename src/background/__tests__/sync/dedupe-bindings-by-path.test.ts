import { dedupeBindingsByCanonicalPath } from '../../sync/sync-manager';
import { SyncBindingCfg } from '../../local-config';

/**
 * Registry backstop for point 3 (super-productivity#9323 second review):
 * two bindings must never sync the same physical file, even if a legacy or
 * hand-edited config expresses the path differently (`/tmp/tasks.md` vs
 * `/tmp/./tasks.md`). The config UI blocks it on entry; this is the startup
 * safety net.
 */
const b = (over: Partial<SyncBindingCfg> & { id: string }): SyncBindingCfg => ({
  filePath: '/tmp/tasks.md',
  projectId: 'p1',
  enabled: true,
  ...over,
});

describe('dedupeBindingsByCanonicalPath (point 3 backstop)', () => {
  it('keeps a single binding per canonical path and reports the duplicate', () => {
    const first = b({ id: 'first', filePath: '/tmp/tasks.md', projectId: 'p1' });
    const dupe = b({ id: 'second', filePath: '/tmp/./tasks.md', projectId: 'p2' });

    const { unique, duplicates } = dedupeBindingsByCanonicalPath([first, dupe]);

    expect(unique.map((x) => x.id)).toEqual(['first']);
    expect(duplicates).toHaveLength(1);
    expect(duplicates[0].binding.id).toBe('second');
    expect(duplicates[0].owner).toBe('first');
  });

  it('keeps distinct files', () => {
    const one = b({ id: 'one', filePath: '/tmp/a.md' });
    const two = b({ id: 'two', filePath: '/tmp/b.md', projectId: 'p2' });

    const { unique, duplicates } = dedupeBindingsByCanonicalPath([one, two]);

    expect(unique.map((x) => x.id)).toEqual(['one', 'two']);
    expect(duplicates).toHaveLength(0);
  });

  it('skips disabled / incomplete bindings without counting them as duplicates', () => {
    const active = b({ id: 'active', filePath: '/tmp/a.md' });
    const disabled = b({ id: 'disabled', filePath: '/tmp/a.md', enabled: false });
    const noProject = b({ id: 'noProject', filePath: '/tmp/a.md', projectId: '' });
    const noFile = b({ id: 'noFile', filePath: '' });

    const { unique, duplicates } = dedupeBindingsByCanonicalPath([
      active,
      disabled,
      noProject,
      noFile,
    ]);

    expect(unique.map((x) => x.id)).toEqual(['active']);
    expect(duplicates).toHaveLength(0);
  });

  it('attributes every duplicate to the first claimant', () => {
    const first = b({ id: 'first', filePath: '/data/tasks.md' });
    const dup1 = b({ id: 'dup1', filePath: '/data/./tasks.md', projectId: 'p2' });
    const dup2 = b({ id: 'dup2', filePath: '/data/sub/../tasks.md', projectId: 'p3' });

    const { unique, duplicates } = dedupeBindingsByCanonicalPath([first, dup1, dup2]);

    expect(unique.map((x) => x.id)).toEqual(['first']);
    expect(duplicates.map((d) => d.binding.id)).toEqual(['dup1', 'dup2']);
    expect(duplicates.every((d) => d.owner === 'first')).toBe(true);
  });
});
