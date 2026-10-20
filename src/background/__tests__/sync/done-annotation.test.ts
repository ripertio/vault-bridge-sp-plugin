import type { Task } from '@super-productivity/plugin-api';
import { parseMarkdown, stripStatusTags } from '../../sync/markdown-parser';
import {
  formatDoneTag,
  buildTaskLine,
  extractDoneTag,
  mergeSpIntoExistingFile,
} from '../../sync/sp-to-md';

const mapOf = (tasks: Task[]): Map<string, Task> => {
  const m = new Map<string, Task>();
  tasks.forEach((t) => m.set(t.id!, t));
  return m;
};

describe('@done annotation', () => {
  describe('stripStatusTags (parser)', () => {
    it('strips a trailing @done with date + time', () => {
      expect(stripStatusTags('Buy milk @done(2026-07-07 14:30)')).toBe('Buy milk');
    });
    it('strips date-only and bare @done', () => {
      expect(stripStatusTags('X @done(2026-07-07)')).toBe('X');
      expect(stripStatusTags('X @done')).toBe('X');
    });
    it('strips @todo / @doing', () => {
      expect(stripStatusTags('X @todo')).toBe('X');
      expect(stripStatusTags('X @doing')).toBe('X');
    });
    it('leaves an @word in the MIDDLE of the title alone', () => {
      expect(stripStatusTags('email @done to bob')).toBe('email @done to bob');
    });
    it('no tag → unchanged', () => {
      expect(stripStatusTags('Plain title')).toBe('Plain title');
    });
  });

  describe('parser: clean title + completed', () => {
    it('done line: title stripped of @done, completed true', () => {
      const [t] = parseMarkdown('- [x] <!--a--> Buy milk @done(2026-07-07 14:30)');
      expect(t.title).toBe('Buy milk');
      expect(t.completed).toBe(true);
    });
    it('accepts date-only @done on read', () => {
      const [t] = parseMarkdown('- [x] <!--a--> Buy milk @done(2026-07-07)');
      expect(t.title).toBe('Buy milk');
      expect(t.completed).toBe(true);
    });
    it('unchecked line with a stray @todo → not completed, clean title', () => {
      const [t] = parseMarkdown('- [ ] <!--a--> Task @todo');
      expect(t.title).toBe('Task');
      expect(t.completed).toBe(false);
    });
  });

  describe('formatDoneTag (write side)', () => {
    it('not done → empty', () => {
      expect(formatDoneTag({ isDone: false } as Task)).toBe('');
    });
    it('done + doneOn → @done(YYYY-MM-DD HH:mm) in local time', () => {
      const doneOn = new Date(2026, 6, 7, 14, 30).getTime(); // local July 7 2026 14:30
      expect(formatDoneTag({ isDone: true, doneOn } as Task)).toBe(' @done(2026-07-07 14:30)');
    });
    it('done without doneOn → bare @done', () => {
      expect(formatDoneTag({ isDone: true, doneOn: null } as Task)).toBe(' @done');
    });
    it('zero-pads month / day / hour / minute', () => {
      const doneOn = new Date(2026, 0, 3, 9, 5).getTime();
      expect(formatDoneTag({ isDone: true, doneOn } as Task)).toBe(' @done(2026-01-03 09:05)');
    });
  });

  describe('buildTaskLine', () => {
    it('done task line carries @done', () => {
      const doneOn = new Date(2026, 6, 7, 14, 30).getTime();
      expect(
        buildTaskLine('', { id: 'a', title: 'Buy milk', isDone: true, doneOn } as Task),
      ).toBe('- [x] <!--a--> Buy milk @done(2026-07-07 14:30)');
    });
    it('active task line has no tag', () => {
      expect(
        buildTaskLine('', { id: 'a', title: 'Buy milk', isDone: false } as Task),
      ).toBe('- [ ] <!--a--> Buy milk');
    });
  });

  describe('in-place merge: done ↔ todo transitions', () => {
    it('completing appends @done; reopening removes it', () => {
      const doneOn = new Date(2026, 6, 7, 14, 30).getTime();
      const done = [{ id: 'a', title: 'Buy milk', isDone: true, doneOn, parentId: null } as Task];
      const out1 = mergeSpIntoExistingFile('- [ ] <!--a--> Buy milk', mapOf(done), done);
      expect(out1).toBe('- [x] <!--a--> Buy milk @done(2026-07-07 14:30)');

      const reopened = [{ id: 'a', title: 'Buy milk', isDone: false, parentId: null } as Task];
      const out2 = mergeSpIntoExistingFile(out1, mapOf(reopened), reopened);
      expect(out2).toBe('- [ ] <!--a--> Buy milk');
    });

    it('is idempotent for an already-@done line', () => {
      const doneOn = new Date(2026, 6, 7, 14, 30).getTime();
      const tasks = [{ id: 'a', title: 'Buy milk', isDone: true, doneOn, parentId: null } as Task];
      const line = '- [x] <!--a--> Buy milk @done(2026-07-07 14:30)';
      expect(mergeSpIntoExistingFile(line, mapOf(tasks), tasks)).toBe(line);
    });

    it('preserves non-task lines around a completed task', () => {
      const doneOn = new Date(2026, 6, 7, 14, 30).getTime();
      const tasks = [{ id: 'a', title: 'Buy milk', isDone: true, doneOn, parentId: null } as Task];
      const input = ['## Section', '- [ ] <!--a--> Buy milk', '  a note', ''].join('\n');
      const out = mergeSpIntoExistingFile(input, mapOf(tasks), tasks);
      expect(out).toBe(['## Section', '- [x] <!--a--> Buy milk @done(2026-07-07 14:30)', '  a note', ''].join('\n'));
    });
  });

  describe('extractDoneTag', () => {
    it('pulls a dated @done', () => {
      expect(extractDoneTag('Task @done(2026-07-07 14:30)')).toBe(' @done(2026-07-07 14:30)');
    });
    it('pulls a date-only @done', () => {
      expect(extractDoneTag('Task @done(2026-07-07)')).toBe(' @done(2026-07-07)');
    });
    it('pulls a bare @done', () => {
      expect(extractDoneTag('Task @done')).toBe(' @done');
    });
    it('returns empty when there is none', () => {
      expect(extractDoneTag('Task')).toBe('');
    });
  });

  describe('bug fixes (round-trip of imported @done)', () => {
    it('BUG 1: preserves an existing @done(date) even when SP doneOn is null', () => {
      // SP imported the file; parser stripped the tag so doneOn is unknown (null).
      const tasks = [{ id: 'a', title: 'Buy milk', isDone: true, doneOn: null, parentId: null } as Task];
      const input = '- [x] <!--a--> Buy milk @done(2026-07-07 14:30)';
      // Must keep the file's date, NOT collapse to bare " @done".
      expect(mergeSpIntoExistingFile(input, mapOf(tasks), tasks)).toBe(input);
    });

    it('BUG 2: a no-ID done line with @done matches by title and gets its ID stamped in place (no duplicate)', () => {
      const tasks = [{ id: 'new1', title: 'Buy milk', isDone: true, doneOn: null, parentId: null } as Task];
      const input = '- [x] Buy milk @done(2026-07-07 14:30)';
      const out = mergeSpIntoExistingFile(input, mapOf(tasks), tasks);
      // Single line: ID stamped, date preserved, and NO duplicate appended below.
      expect(out).toBe('- [x] <!--new1--> Buy milk @done(2026-07-07 14:30)');
    });

    it('a task newly completed in SP (no existing tag) still gets its doneOn date', () => {
      const doneOn = new Date(2026, 6, 7, 14, 30).getTime();
      const tasks = [{ id: 'a', title: 'Buy milk', isDone: true, doneOn, parentId: null } as Task];
      const input = '- [ ] <!--a--> Buy milk';
      expect(mergeSpIntoExistingFile(input, mapOf(tasks), tasks)).toBe(
        '- [x] <!--a--> Buy milk @done(2026-07-07 14:30)',
      );
    });
  });
});
