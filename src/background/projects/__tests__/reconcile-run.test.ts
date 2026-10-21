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
  createProject: jest.fn(async () => 'new-id'),
  writeBacklog: jest.fn(async () => undefined),
});

describe('runProjectsReconcile', () => {
  it('creates a project for a folder and a folder + backlog for a project (write mode)', async () => {
    const d = deps();
    const n = await runProjectsReconcile(plan, '/vault/Projects', false, d);
    expect(d.createProject).toHaveBeenCalledWith('New folder');
    expect(d.writeBacklog).toHaveBeenCalledWith({
      id: 'auto-p1',
      filePath: '/vault/Projects/Beta/backlog.md',
      projectId: 'p1',
      enabled: true,
      projectTitle: 'Beta',
    });
    expect(n).toBe(2);
  });

  it('changes nothing in dry-run', async () => {
    const d = deps();
    const n = await runProjectsReconcile(plan, '/vault/Projects', true, d);
    expect(d.createProject).not.toHaveBeenCalled();
    expect(d.writeBacklog).not.toHaveBeenCalled();
    expect(n).toBe(0);
  });

  it('keeps going when one item fails', async () => {
    const d = deps();
    d.createProject.mockRejectedValueOnce(new Error('boom'));
    const n = await runProjectsReconcile(plan, '/vault/Projects', false, d);
    expect(d.writeBacklog).toHaveBeenCalledTimes(1);
    expect(n).toBe(1);
  });

  it('never removes anything (only create callbacks are used)', async () => {
    const d = deps();
    await runProjectsReconcile(plan, '/vault/Projects', false, d);
    expect(Object.keys(d).sort()).toEqual(['createProject', 'writeBacklog']);
  });
});
