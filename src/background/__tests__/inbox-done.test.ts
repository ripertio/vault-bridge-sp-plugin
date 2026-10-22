import { setInboxRemoveDone, removesDone } from '../sync/inbox-done';
import { mergeSpIntoExistingFile } from '../sync/sp-to-md';
import { INBOX_PROJECT_ID } from '../daily/daily-plan';

describe('removesDone', () => {
  afterEach(() => setInboxRemoveDone(false));

  it('is off by default, for the Inbox too', () => {
    expect(removesDone(INBOX_PROJECT_ID)).toBe(false);
  });

  it('applies only to the Inbox project, and only when the setting is on', () => {
    setInboxRemoveDone(true);
    expect(removesDone(INBOX_PROJECT_ID)).toBe(true);
    expect(removesDone('some-project')).toBe(false);
  });
});

describe('a done task leaves the file when it is not in the task map', () => {
  it('removes its line', () => {
    const out = mergeSpIntoExistingFile('- [x] <!--d1--> Done\n- [ ] <!--o2--> Open\n', new Map(), [], new Set());
    expect(out).not.toContain('d1');
  });
});
