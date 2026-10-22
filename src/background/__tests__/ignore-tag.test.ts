import { setIgnoreTagEnabled, isIgnoredTitle, ignoredIdsInMarkdown, withoutIgnored } from '../sync/ignore-tag';
import { mergeSpIntoExistingFile } from '../sync/sp-to-md';

describe('ignore tag', () => {
  afterEach(() => setIgnoreTagEnabled(false));

  it('does nothing while the setting is off (the default)', () => {
    expect(isIgnoredTitle('Draft #ignore')).toBe(false);
    expect(ignoredIdsInMarkdown('- [ ] <!--a1--> Draft #ignore')).toEqual(new Set());
  });

  it('matches the tag as a whole word, anywhere in the title', () => {
    setIgnoreTagEnabled(true);
    expect(isIgnoredTitle('Draft #ignore')).toBe(true);
    expect(isIgnoredTitle('#ignore draft')).toBe(true);
    expect(isIgnoredTitle('Draft #IGNORE now')).toBe(true);
    expect(isIgnoredTitle('Draft #ignored')).toBe(false);
    expect(isIgnoredTitle('Draft ignore')).toBe(false);
  });

  it('collects the IDs of Markdown lines that carry the tag', () => {
    setIgnoreTagEnabled(true);
    const md = ['- [ ] <!--a1--> Keep', '- [ ] <!--b2--> Skip #ignore', '  - [x] <!--c3--> sub #ignore'].join('\n');
    expect(ignoredIdsInMarkdown(md)).toEqual(new Set(['b2', 'c3']));
  });
});

describe('withoutIgnored', () => {
  afterEach(() => setIgnoreTagEnabled(false));

  const md = (id: string | null, title: string, parentId: string | null = null) => ({ id, title, parentId });
  const sp = (id: string, title: string, parentId: string | null = null) => ({ id, title, parentId });

  it('returns both sides unchanged while the setting is off', () => {
    const parsed = [md('a', 'Draft #ignore')];
    const spTasks = [sp('a', 'Draft #ignore')];
    expect(withoutIgnored(parsed, spTasks)).toEqual({ parsed, spTasks });
  });

  it('drops a tagged task from both sides, and its children', () => {
    setIgnoreTagEnabled(true);
    const parsed = [md('p', 'Parent #ignore'), md('c', 'Child', 'p'), md('k', 'Keep')];
    const spTasks = [sp('p', 'Parent #ignore'), sp('c', 'Child', 'p'), sp('k', 'Keep')];
    const out = withoutIgnored(parsed, spTasks);
    expect(out.parsed.map((t) => t.id)).toEqual(['k']);
    expect(out.spTasks.map((t) => t.id)).toEqual(['k']);
  });

  it('keeps a markdown line whose SP task is tagged out of the diff, so it is not recreated', () => {
    setIgnoreTagEnabled(true);
    const parsed = [md('a', 'Draft')];
    const spTasks = [sp('a', 'Draft #ignore')];
    const out = withoutIgnored(parsed, spTasks);
    expect(out.parsed).toEqual([]);
    expect(out.spTasks).toEqual([]);
  });

  it('drops an untagged-ID-less line that carries the tag', () => {
    setIgnoreTagEnabled(true);
    const out = withoutIgnored([md(null, 'New thing #ignore')], []);
    expect(out.parsed).toEqual([]);
  });
});

describe('mergeSpIntoExistingFile keeps ignored lines', () => {
  it('keeps a kept ID line as it is, and still removes a normal line whose task is gone', () => {
    const content = '- [ ] <!--x1--> Keep #ignore\n- [ ] <!--y2--> Gone\n';
    const out = mergeSpIntoExistingFile(content, new Map(), [], new Set(['x1']));
    expect(out).toContain('- [ ] <!--x1--> Keep #ignore');
    expect(out).not.toContain('y2');
  });
});
