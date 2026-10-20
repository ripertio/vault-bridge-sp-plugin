import {
  showMissingFileDialog,
  showMissingProjectDialog,
  createSpProject,
} from '../../sync/missing-resource';

jest.mock('../../../shared/logger', () => ({
  log: {
    critical: jest.fn(),
    err: jest.fn(),
    error: jest.fn(),
    log: jest.fn(),
    normal: jest.fn(),
    info: jest.fn(),
    verbose: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
  },
}));

describe('showMissingFileDialog', () => {
  const handlers = () => ({
    onRecreate: jest.fn().mockResolvedValue(undefined),
    onDelete: jest.fn().mockResolvedValue(undefined),
    onIgnore: jest.fn().mockResolvedValue(undefined),
  });

  beforeEach(() => {
    jest.clearAllMocks();
    (global as any).PluginAPI = {
      showSnack: jest.fn(),
      // openDialog set per-test
    };
  });

  it('falls back to onRecreate when openDialog is unavailable', async () => {
    const h = handlers();
    await showMissingFileDialog('/test/tasks.md', h);

    expect(h.onRecreate).toHaveBeenCalledTimes(1);
    expect(h.onDelete).not.toHaveBeenCalled();
    expect(h.onIgnore).not.toHaveBeenCalled();
  });

  it('renders exactly the 3 expected buttons with correct labels and colors', async () => {
    let captured: any;
    (global as any).PluginAPI.openDialog = jest.fn(async (cfg: any) => {
      captured = cfg;
    });

    await showMissingFileDialog('/test/tasks.md', handlers());

    expect(captured.buttons).toHaveLength(3);
    expect(captured.buttons[0]).toMatchObject({ label: 'Recreate from SP', color: 'primary' });
    expect(captured.buttons[1]).toMatchObject({ label: 'Delete binding', color: 'warn' });
    expect(captured.buttons[2].label).toBe('Ignore');
    // Ignore button must NOT be colored primary/warn.
    expect(captured.buttons[2].color).toBeUndefined();
  });

  it('invokes onRecreate when the primary button is clicked', async () => {
    const h = handlers();
    (global as any).PluginAPI.openDialog = jest.fn(async (cfg: any) => {
      await cfg.buttons[0].onClick();
    });

    await showMissingFileDialog('/test/tasks.md', h);
    expect(h.onRecreate).toHaveBeenCalledTimes(1);
    expect(h.onDelete).not.toHaveBeenCalled();
  });

  it('invokes onDelete when the warn button is clicked', async () => {
    const h = handlers();
    (global as any).PluginAPI.openDialog = jest.fn(async (cfg: any) => {
      await cfg.buttons[1].onClick();
    });

    await showMissingFileDialog('/test/tasks.md', h);
    expect(h.onDelete).toHaveBeenCalledTimes(1);
    expect(h.onRecreate).not.toHaveBeenCalled();
  });

  it('invokes onIgnore when the plain button is clicked', async () => {
    const h = handlers();
    (global as any).PluginAPI.openDialog = jest.fn(async (cfg: any) => {
      await cfg.buttons[2].onClick();
    });

    await showMissingFileDialog('/test/tasks.md', h);
    expect(h.onIgnore).toHaveBeenCalledTimes(1);
  });

  it('escapes the file path in the dialog HTML (no HTML injection)', async () => {
    let captured: any;
    (global as any).PluginAPI.openDialog = jest.fn(async (cfg: any) => {
      captured = cfg;
    });

    await showMissingFileDialog('/tmp/<script>evil</script>.md', handlers());

    expect(captured.htmlContent).toContain('&lt;script&gt;evil&lt;/script&gt;');
    expect(captured.htmlContent).not.toContain('<script>evil</script>');
  });

  it('surfaces a snack and does not throw when openDialog rejects', async () => {
    (global as any).PluginAPI.openDialog = jest.fn().mockRejectedValue(new Error('boom'));

    await expect(showMissingFileDialog('/test/tasks.md', handlers())).resolves.toBeUndefined();
    expect((global as any).PluginAPI.showSnack).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'ERROR' }),
    );
  });
});

describe('showMissingProjectDialog', () => {
  const projectHandlers = () => ({
    onRecreate: jest.fn().mockResolvedValue(undefined),
    onDelete: jest.fn().mockResolvedValue(undefined),
    onIgnore: jest.fn().mockResolvedValue(undefined),
  });

  beforeEach(() => {
    jest.clearAllMocks();
    (global as any).PluginAPI = { showSnack: jest.fn() };
  });

  it('offers Recreate + Delete + Ignore when the file exists (canRecreate=true)', async () => {
    let captured: any;
    (global as any).PluginAPI.openDialog = jest.fn(async (cfg: any) => {
      captured = cfg;
    });

    await showMissingProjectDialog('/test/tasks.md', projectHandlers(), true);

    expect(captured.buttons).toHaveLength(3);
    expect(captured.buttons[0]).toMatchObject({ label: 'Recreate project in SP', color: 'primary' });
    expect(captured.buttons[1]).toMatchObject({ label: 'Delete binding', color: 'warn' });
    expect(captured.buttons[2].label).toBe('Ignore');
    expect(captured.buttons[2].color).toBeUndefined();
  });

  it('offers Delete + Ignore when the file is also missing (canRecreate=false)', async () => {
    let captured: any;
    (global as any).PluginAPI.openDialog = jest.fn(async (cfg: any) => {
      captured = cfg;
    });

    await showMissingProjectDialog('/test/tasks.md', projectHandlers(), false);

    expect(captured.buttons.map((b: any) => b.label)).toEqual(['Delete binding', 'Ignore']);
  });

  it('invokes onIgnore when the Ignore button is clicked', async () => {
    const h = projectHandlers();
    (global as any).PluginAPI.openDialog = jest.fn(async (cfg: any) => {
      await cfg.buttons.find((b: any) => b.label === 'Ignore').onClick();
    });

    await showMissingProjectDialog('/test/tasks.md', h, true);
    expect(h.onIgnore).toHaveBeenCalledTimes(1);
    expect(h.onRecreate).not.toHaveBeenCalled();
    expect(h.onDelete).not.toHaveBeenCalled();
  });

  it('fallback with no openDialog: recreate when possible, delete otherwise', async () => {
    const h1 = projectHandlers();
    await showMissingProjectDialog('/test/tasks.md', h1, true);
    expect(h1.onRecreate).toHaveBeenCalledTimes(1);
    expect(h1.onDelete).not.toHaveBeenCalled();

    const h2 = projectHandlers();
    await showMissingProjectDialog('/test/tasks.md', h2, false);
    expect(h2.onDelete).toHaveBeenCalledTimes(1);
    expect(h2.onRecreate).not.toHaveBeenCalled();
  });

  // Improvement C2: "Delete + clean file" parity with the config-panel delete.
  const cleanHandlers = () => ({
    ...projectHandlers(),
    onDeleteAndClean: jest.fn().mockResolvedValue(undefined),
  });

  it('adds "Delete + clean file" when onDeleteAndClean is given AND the file exists', async () => {
    let captured: any;
    (global as any).PluginAPI.openDialog = jest.fn(async (cfg: any) => {
      captured = cfg;
    });

    await showMissingProjectDialog('/test/tasks.md', cleanHandlers(), true);

    expect(captured.buttons.map((b: any) => b.label)).toEqual([
      'Recreate project in SP',
      'Delete binding',
      'Delete + clean file',
      'Ignore',
    ]);
    const clean = captured.buttons.find((b: any) => b.label === 'Delete + clean file');
    expect(clean.color).toBe('warn');
    expect(captured.htmlContent).toContain('Delete + clean file');
  });

  it('does NOT add "Delete + clean file" when the file is also missing (canRecreate=false)', async () => {
    let captured: any;
    (global as any).PluginAPI.openDialog = jest.fn(async (cfg: any) => {
      captured = cfg;
    });

    await showMissingProjectDialog('/test/tasks.md', cleanHandlers(), false);

    expect(captured.buttons.map((b: any) => b.label)).toEqual(['Delete binding', 'Ignore']);
    expect(captured.htmlContent).not.toContain('Delete + clean file');
  });

  it('invokes onDeleteAndClean (not onDelete) when its button is clicked', async () => {
    const h = cleanHandlers();
    (global as any).PluginAPI.openDialog = jest.fn(async (cfg: any) => {
      await cfg.buttons.find((b: any) => b.label === 'Delete + clean file').onClick();
    });

    await showMissingProjectDialog('/test/tasks.md', h, true);
    expect(h.onDeleteAndClean).toHaveBeenCalledTimes(1);
    expect(h.onDelete).not.toHaveBeenCalled();
    expect(h.onRecreate).not.toHaveBeenCalled();
  });
});

describe('createSpProject', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (global as any).PluginAPI = { showSnack: jest.fn() };
  });

  it('calls addProject with the title and returns the new id', async () => {
    (global as any).PluginAPI.addProject = jest.fn().mockResolvedValue('new-id');

    const id = await createSpProject('My Project');

    expect((global as any).PluginAPI.addProject).toHaveBeenCalledWith({ title: 'My Project' });
    expect(id).toBe('new-id');
  });

  it('throws when addProject is unavailable', async () => {
    await expect(createSpProject('X')).rejects.toThrow('addProject is not available');
  });
});
