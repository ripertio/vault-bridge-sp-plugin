jest.mock('../../../shared/logger', () => ({
  log: { log: jest.fn(), error: jest.fn() },
}));

import { runProjectsReconcile } from '../reconcile-run';

const plan = {
  projectsToCreate: ['New folder'],
  foldersToCreate: [{ id: 'p1', title: 'Beta' }],
  ambiguous: [],
};

const deps = () => ({
  askCreateProject: jest.fn(),
  writeBacklog: jest.fn(async () => undefined),
});

describe('runProjectsReconcile', () => {
  it('asks about a folder without a project and creates a folder + backlog for a project (write mode)', async () => {
    const d = deps();
    const n = await runProjectsReconcile(plan, '/vault/Projects', 'backlog.md', false, d);
    expect(d.askCreateProject).toHaveBeenCalledWith('New folder');
    expect(d.writeBacklog).toHaveBeenCalledWith({
      id: 'auto-p1',
      filePath: '/vault/Projects/Beta/backlog.md',
      projectId: 'p1',
      enabled: true,
      projectTitle: 'Beta',
    });
    expect(n).toBe(1);
  });

  it('uses the configured task file name for the new folder binding', async () => {
    const d = deps();
    await runProjectsReconcile(plan, '/vault/Projects', 'tasks.md', false, d);
    expect(d.writeBacklog).toHaveBeenCalledWith(expect.objectContaining({ filePath: '/vault/Projects/Beta/tasks.md' }));
  });

  it('changes nothing in dry-run and does not ask', async () => {
    const d = deps();
    const n = await runProjectsReconcile(plan, '/vault/Projects', 'backlog.md', true, d);
    expect(d.askCreateProject).not.toHaveBeenCalled();
    expect(d.writeBacklog).not.toHaveBeenCalled();
    expect(n).toBe(0);
  });

  it('never removes anything (only ask and create-folder callbacks are used)', async () => {
    const d = deps();
    await runProjectsReconcile(plan, '/vault/Projects', 'backlog.md', false, d);
    expect(Object.keys(d).sort()).toEqual(['askCreateProject', 'writeBacklog']);
  });
});
