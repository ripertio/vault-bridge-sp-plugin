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
  askCreateFolder: jest.fn(),
});

describe('runProjectsReconcile', () => {
  it('asks about a folder without a project, and about a project without a folder', () => {
    const d = deps();
    runProjectsReconcile(plan, '/vault/Projects', 'backlog.md', false, d);
    expect(d.askCreateProject).toHaveBeenCalledWith('New folder');
    expect(d.askCreateFolder).toHaveBeenCalledWith('Beta', {
      id: 'auto-p1',
      filePath: '/vault/Projects/Beta/backlog.md',
      projectId: 'p1',
      enabled: true,
      projectTitle: 'Beta',
    });
  });

  it('uses the configured task file name in the binding it offers', () => {
    const d = deps();
    runProjectsReconcile(plan, '/vault/Projects', 'tasks.md', false, d);
    expect(d.askCreateFolder).toHaveBeenCalledWith('Beta', expect.objectContaining({ filePath: '/vault/Projects/Beta/tasks.md' }));
  });

  it('asks nothing in dry-run', () => {
    const d = deps();
    runProjectsReconcile(plan, '/vault/Projects', 'backlog.md', true, d);
    expect(d.askCreateProject).not.toHaveBeenCalled();
    expect(d.askCreateFolder).not.toHaveBeenCalled();
  });

  it('only ever asks (never creates directly)', () => {
    const d = deps();
    runProjectsReconcile(plan, '/vault/Projects', 'backlog.md', false, d);
    expect(Object.keys(d).sort()).toEqual(['askCreateFolder', 'askCreateProject']);
  });
});
