import { diffNoteAgainstBaseline, parseNoteTaskLine } from '../daily-reverse';

const base = { p1: { isDone: false, title: 'Project task' } };

describe('parseNoteTaskLine', () => {
  it('parses checkbox, id and title', () => {
    expect(parseNoteTaskLine('- [x] <!--p1--> Project task')).toEqual({
      id: 'p1',
      isDone: true,
      title: 'Project task',
    });
  });

  it('returns null for lines without an id marker', () => {
    expect(parseNoteTaskLine('Wenn ich hier was schreibe')).toBeNull();
  });
});

describe('diffNoteAgainstBaseline', () => {
  it('pushes a checkbox the user ticked in the note to SP', () => {
    const changes = diffNoteAgainstBaseline(['- [x] <!--p1--> Project task'], base, { p1: false });
    expect(changes).toEqual([{ taskId: 'p1', updates: { isDone: true } }]);
  });

  it('pushes a title edit to SP', () => {
    const changes = diffNoteAgainstBaseline(['- [ ] <!--p1--> Renamed'], base, { p1: false });
    expect(changes).toEqual([{ taskId: 'p1', updates: { title: 'Renamed' } }]);
  });

  it('SP wins the checkbox when both sides changed', () => {
    const changes = diffNoteAgainstBaseline(['- [x] <!--p1--> Project task'], base, { p1: true });
    expect(changes).toEqual([]);
  });

  it('ignores lines that are not in the baseline (never adopts foreign tasks)', () => {
    const changes = diffNoteAgainstBaseline(['- [x] <!--zzz--> Unknown'], base, {});
    expect(changes).toEqual([]);
  });

  it('ignores free text and unmarked lines', () => {
    const changes = diffNoteAgainstBaseline(['Wenn ich hier was schreibe', '## To Dos'], base, {});
    expect(changes).toEqual([]);
  });

  it('reports nothing when the note matches the baseline', () => {
    expect(diffNoteAgainstBaseline(['- [ ] <!--p1--> Project task'], base, { p1: false })).toEqual([]);
  });
});
