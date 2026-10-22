import { showCreateFolderDialog } from '../create-folder-dialog';

jest.mock('../../../shared/logger', () => ({ log: { log: jest.fn(), error: jest.fn() } }));

type Button = { label: string; onClick?: () => void | Promise<void> };
type Cfg = { htmlContent?: string; buttons?: Button[] };

const g = globalThis as unknown as { PluginAPI: Record<string, unknown> };

describe('showCreateFolderDialog', () => {
  afterEach(() => {
    delete g.PluginAPI.openDialog;
  });

  it('offers Create, Ignore and Keep for now', async () => {
    const openDialog = jest.fn(async (_cfg: Cfg) => undefined);
    g.PluginAPI.openDialog = openDialog;
    const shown = await showCreateFolderDialog('Beta', 'backlog.md', { onCreate: jest.fn(), onIgnore: jest.fn() });
    expect(shown).toBe(true);
    expect(openDialog.mock.calls[0][0].buttons?.map((b) => b.label)).toEqual(['Create', 'Ignore', 'Keep for now']);
  });

  it('runs only the handler of the pressed button', async () => {
    const onCreate = jest.fn();
    const onIgnore = jest.fn();
    let cfg: Cfg = {};
    g.PluginAPI.openDialog = async (c: Cfg) => {
      cfg = c;
    };
    await showCreateFolderDialog('Beta', 'backlog.md', { onCreate, onIgnore });
    await cfg.buttons?.[0].onClick?.();
    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(onIgnore).not.toHaveBeenCalled();
  });

  it('names the task file it would create', async () => {
    let cfg: Cfg = {};
    g.PluginAPI.openDialog = async (c: Cfg) => {
      cfg = c;
    };
    await showCreateFolderDialog('Beta', 'tasks.md', { onCreate: jest.fn(), onIgnore: jest.fn() });
    expect(cfg.htmlContent).toContain('tasks.md');
  });

  it('creates nothing when SP dialogs are unavailable', async () => {
    const onCreate = jest.fn();
    expect(await showCreateFolderDialog('Beta', 'backlog.md', { onCreate, onIgnore: jest.fn() })).toBe(false);
    expect(onCreate).not.toHaveBeenCalled();
  });
});
