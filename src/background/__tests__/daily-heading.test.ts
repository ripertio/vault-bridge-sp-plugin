import { findToDosSection, normalizeTodosHeading, DEFAULT_DAILY_NOTE_CFG } from '../daily/daily-note';
import { planDailyNote } from '../daily/daily-plan';
import { validateDailySettings } from '../daily/daily-settings';

describe('custom To Dos heading', () => {
  it('normalizes user input', () => {
    expect(normalizeTodosHeading('Tasks')).toBe('## Tasks');
    expect(normalizeTodosHeading('### Tasks')).toBe('### Tasks');
    expect(normalizeTodosHeading('  ')).toBe('## To Dos');
    expect(normalizeTodosHeading(undefined)).toBe('## To Dos');
  });

  it('ends the section at a heading of the same or higher level only', () => {
    const lines = ['# Day', '### Tasks', '- a', '#### sub', '- b', '### Notes', 'x'];
    expect(findToDosSection(lines, '### Tasks')).toEqual({ headingIndex: 1, bodyStart: 2, bodyEnd: 5 });
    expect(findToDosSection(lines, '## Tasks')).toBeNull();
  });

  it('adds missing tasks under the custom heading', () => {
    const cfg = { ...DEFAULT_DAILY_NOTE_CFG, todosHeading: '## Plan' };
    const res = planDailyNote(cfg, ['## Plan', '', '## Log'], [{ id: 'a', title: 'T', isDone: false, projectId: 'p' }]);
    expect(res.nextLines.indexOf('- [ ] <!--a--> T')).toBeGreaterThan(res.nextLines.indexOf('## Plan'));
    expect(res.nextLines.indexOf('- [ ] <!--a--> T')).toBeLessThan(res.nextLines.indexOf('## Log'));
  });

  it('saves a normalized heading', () => {
    const r = validateDailySettings({ todosHeading: 'Plan' });
    expect(r.ok && r.cfg.todosHeading).toBe('## Plan');
  });
});
