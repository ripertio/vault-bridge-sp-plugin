import { folderListChanged } from '../folder-poll';

describe('folderListChanged', () => {
  it('does not trigger on the first poll (baseline only)', () => {
    expect(folderListChanged(null, ['A'])).toBe(false);
  });

  it('triggers when a folder is renamed', () => {
    expect(folderListChanged(['A'], ['B'])).toBe(true);
  });

  it('triggers when a folder is added or removed', () => {
    expect(folderListChanged(['A'], ['A', 'B'])).toBe(true);
    expect(folderListChanged(['A', 'B'], ['A'])).toBe(true);
  });

  it('ignores order changes', () => {
    expect(folderListChanged(['A', 'B'], ['B', 'A'])).toBe(false);
  });

  it('does not trigger when nothing changed', () => {
    expect(folderListChanged(['A'], ['A'])).toBe(false);
  });
});
