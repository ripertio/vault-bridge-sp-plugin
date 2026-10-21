import { DEFAULT_DAILY_NOTE_CFG } from '../daily-note';
import { planDailyNote } from '../daily-plan';

const cfg = { ...DEFAULT_DAILY_NOTE_CFG, enabled: true };

const inbox = { id: 'i1', title: 'Inbox task', isDone: false, projectId: 'INBOX_PROJECT' };
const proj = { id: 'p1', title: 'Project task', isDone: true, projectId: 'S3GlyLNqXxnsItZxKvEdQ' };

describe('planDailyNote', () => {
  it('adds planned tasks under ## To Dos and reports them', () => {
    const lines = ['# 2026-10-21', '## To Dos'];
    const result = planDailyNote(cfg, lines, [proj]);
    expect(result.missingTaskIds).toEqual(['p1']);
    expect(result.nextLines).toEqual([
      '# 2026-10-21',
      '## To Dos',
      '- [x] <!--p1--> Project task',
    ]);
  });

  it('inserts before the next heading and keeps other content', () => {
    const lines = ['## To Dos', '- [ ] <!--x--> old', '## Notes', 'keep me'];
    const result = planDailyNote(cfg, lines, [proj]);
    expect(result.nextLines).toEqual([
      '## To Dos',
      '- [ ] <!--x--> old',
      '- [x] <!--p1--> Project task',
      '## Notes',
      'keep me',
    ]);
  });

  it('does not duplicate a task that is already in the note', () => {
    const lines = ['## To Dos', '- [ ] <!--p1--> Project task'];
    const result = planDailyNote(cfg, lines, [proj]);
    expect(result.missingTaskIds).toEqual([]);
    expect(result.nextLines).toEqual(['## To Dos', '- [x] <!--p1--> Project task']);
  });

  it('creates the ## To Dos heading when it is absent', () => {
    const result = planDailyNote(cfg, ['# Day'], [proj]);
    expect(result.nextLines).toEqual(['# Day', '', '## To Dos', '- [x] <!--p1--> Project task']);
    expect(result.missingTaskIds).toEqual(['p1']);
  });

  it('excludes Inbox tasks when includeInbox is off', () => {
    const result = planDailyNote({ ...cfg, includeInbox: false }, ['## To Dos'], [inbox, proj]);
    expect(result.missingTaskIds).toEqual(['p1']);
  });

  it('keeps Inbox tasks when includeInbox is on', () => {
    const result = planDailyNote(cfg, ['## To Dos'], [inbox, proj]);
    expect(result.missingTaskIds).toEqual(['i1', 'p1']);
  });

  it('treats a null projectId as Inbox', () => {
    const nullProj = { ...inbox, id: 'n1', projectId: null };
    const result = planDailyNote({ ...cfg, includeInbox: false }, ['## To Dos'], [nullProj]);
    expect(result.missingTaskIds).toEqual([]);
  });

  it('produces a dry-run log without changing the input', () => {
    const lines = ['## To Dos'];
    const result = planDailyNote(cfg, lines, [proj]);
    expect(result.logLines[0]).toBe('would add 1 task(s) to ## To Dos');
    expect(lines).toEqual(['## To Dos']);
  });
});

describe('planDailyNote write output', () => {
  it('joins nextLines with newlines and keeps the trailing newline state', () => {
    const result = planDailyNote(cfg, ['## To Dos', ''], [proj]);
    expect(result.nextLines.join('\n')).toBe('## To Dos\n- [x] <!--p1--> Project task\n');
  });

  it('returns no changes when nothing is missing', () => {
    const lines = ['## To Dos', '- [x] <!--p1--> Project task'];
    const result = planDailyNote(cfg, lines, [proj]);
    expect(result.nextLines.join('\n')).toBe(lines.join('\n'));
  });
});

describe('planDailyNote checkbox sync (SP → Markdown)', () => {
  const open = { id: 'p1', title: 'Project task', isDone: false, projectId: 'S3' };
  const done = { ...open, isDone: true };

  it('checks a line when the SP task is done', () => {
    const lines = ['## To Dos', '- [ ] <!--p1--> Project task'];
    const result = planDailyNote(cfg, lines, [done]);
    expect(result.nextLines).toEqual(['## To Dos', '- [x] <!--p1--> Project task']);
    expect(result.statusChangedTaskIds).toEqual(['p1']);
    expect(result.missingTaskIds).toEqual([]);
  });

  it('unchecks a line when the SP task is reopened', () => {
    const lines = ['## To Dos', '- [x] <!--p1--> Project task'];
    const result = planDailyNote(cfg, lines, [open]);
    expect(result.nextLines).toEqual(['## To Dos', '- [ ] <!--p1--> Project task']);
    expect(result.statusChangedTaskIds).toEqual(['p1']);
  });

  it('leaves the title and other lines untouched', () => {
    const lines = ['## To Dos', '- [ ] <!--p1--> My edited title', 'Some note', '- [ ] <!--x--> other'];
    const result = planDailyNote(cfg, lines, [done]);
    expect(result.nextLines).toEqual(['## To Dos', '- [x] <!--p1--> My edited title', 'Some note', '- [ ] <!--x--> other']);
  });

  it('reports no change when the checkbox already matches', () => {
    const lines = ['## To Dos', '- [x] <!--p1--> Project task'];
    const result = planDailyNote(cfg, lines, [done]);
    expect(result.statusChangedTaskIds).toEqual([]);
    expect(result.nextLines).toEqual(lines);
  });

  it('does not touch lines outside ## To Dos', () => {
    const lines = ['## Notes', '- [ ] <!--p1--> outside', '## To Dos'];
    const result = planDailyNote(cfg, lines, [done]);
    expect(result.nextLines).toEqual([...lines, '- [x] <!--p1--> Project task']);
  });
});
