import { findNewTaskLines, stampNewTaskLine } from '../daily-create';

describe('findNewTaskLines', () => {
  it('finds task lines without an ID inside the section', () => {
    const lines = ['## To Dos', '- [ ] <!--a--> known', '- [ ] Neuer Task', '- [x] done new'];
    expect(findNewTaskLines(lines, 1, 4)).toEqual([
      { lineIndex: 2, title: 'Neuer Task', isDone: false },
      { lineIndex: 3, title: 'done new', isDone: true },
    ]);
  });

  it('ignores lines outside the section', () => {
    const lines = ['- [ ] outside', '## To Dos', '- [ ] inside'];
    expect(findNewTaskLines(lines, 2, 3)).toEqual([{ lineIndex: 2, title: 'inside', isDone: false }]);
  });

  it('ignores empty checkboxes and plain text', () => {
    const lines = ['## To Dos', '- [ ]', 'Wenn ich hier was schreibe', '- [ ] real'];
    expect(findNewTaskLines(lines, 1, 4)).toEqual([{ lineIndex: 3, title: 'real', isDone: false }]);
  });
});

describe('stampNewTaskLine', () => {
  it('adds the ID after the checkbox and keeps the title', () => {
    expect(stampNewTaskLine('- [ ] Neuer Task', 'X1')).toBe('- [ ] <!--X1--> Neuer Task');
  });

  it('keeps a done checkbox', () => {
    expect(stampNewTaskLine('- [x] done new', 'X2')).toBe('- [x] <!--X2--> done new');
  });

  it('returns non-task lines unchanged', () => {
    expect(stampNewTaskLine('plain text', 'X3')).toBe('plain text');
  });
});
