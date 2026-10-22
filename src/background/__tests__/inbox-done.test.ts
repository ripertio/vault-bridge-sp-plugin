import { setInboxRemoveDone, removesDone } from '../sync/inbox-done';
import { mdToSp } from '../sync/md-to-sp';
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
    const out = mergeSpIntoExistingFile('- [x] <!--d1--> Done\n- [ ] <!--o2--> Open\n', new Map(), []);
    expect(out).not.toContain('d1');
  });
});

describe('mdToSp on the Inbox file', () => {
  const batch = jest.fn(async (_req: { projectId: string; operations: any[] }) => ({ success: true, results: [] }));
  const setup = (tasks: { id: string; title: string; isDone: boolean; projectId: string }[]) => {
    (global as any).PluginAPI = {
      getTasks: jest.fn(async () => tasks),
      getAllProjects: jest.fn(async () => [{ id: INBOX_PROJECT_ID, title: 'Inbox', taskIds: [] }]),
      batchUpdateForProject: batch,
      showSnack: jest.fn(),
    };
    batch.mockClear();
  };
  const allOps = () => batch.mock.calls.flatMap((c) => c[0].operations);

  afterEach(() => setInboxRemoveDone(false));

  it('sets a done task back to open when its line is unchecked in the file', async () => {
    setInboxRemoveDone(true);
    setup([{ id: 'd1', title: 'Task', isDone: true, projectId: INBOX_PROJECT_ID }]);
    await mdToSp('- [ ] <!--d1--> Task\n', INBOX_PROJECT_ID);
    expect(JSON.stringify(allOps())).toContain('"isDone":false');
    expect(JSON.stringify(allOps())).not.toContain('"type":"delete"');
  });

  it('never deletes a done task that has left the file', async () => {
    setInboxRemoveDone(true);
    setup([{ id: 'd1', title: 'Task', isDone: true, projectId: INBOX_PROJECT_ID }]);
    await mdToSp('', INBOX_PROJECT_ID);
    expect(JSON.stringify(allOps())).not.toContain('"type":"delete"');
  });
});
