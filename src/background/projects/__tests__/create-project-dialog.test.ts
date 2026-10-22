import { showCreateProjectDialog } from '../create-project-dialog';

jest.mock('../../../shared/logger', () => ({ log: { log: jest.fn(), error: jest.fn() } }));

type Button = { label: string; onClick?: () => void | Promise<void> };
type Cfg = { htmlContent?: string; buttons?: Button[] };

const g = globalThis as unknown as { PluginAPI: Record<string, unknown> };

describe('showCreateProjectDialog', () => {
  afterEach(() => {
    delete g.PluginAPI.openDialog;
  });

  it('offers Create, Ignore and Keep for now', async () => {
    const openDialog = jest.fn(async (_cfg: Cfg) => undefined);
    g.PluginAPI.openDialog = openDialog;
    const shown = await showCreateProjectDialog('New', { onCreate: jest.fn(), onIgnore: jest.fn() });
    expect(shown).toBe(true);
    const labels = openDialog.mock.calls[0][0].buttons?.map((b) => b.label);
    expect(labels).toEqual(['Create', 'Ignore', 'Keep for now']);
  });

  it('runs only the handler of the pressed button', async () => {
    const onCreate = jest.fn();
    const onIgnore = jest.fn();
    let cfg: Cfg = {};
    g.PluginAPI.openDialog = async (c: Cfg) => {
      cfg = c;
    };
    await showCreateProjectDialog('New', { onCreate, onIgnore });
    await cfg.buttons?.[1].onClick?.();
    expect(onIgnore).toHaveBeenCalledTimes(1);
    expect(onCreate).not.toHaveBeenCalled();
    expect(cfg.buttons?.[2].onClick).toBeUndefined();
  });

  it('creates nothing when the user has not pressed a button', async () => {
    const onCreate = jest.fn();
    g.PluginAPI.openDialog = async () => undefined;
    await showCreateProjectDialog('New', { onCreate, onIgnore: jest.fn() });
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('escapes the folder name in the HTML', async () => {
    let cfg: Cfg = {};
    g.PluginAPI.openDialog = async (c: Cfg) => {
      cfg = c;
    };
    await showCreateProjectDialog('<img src=x>', { onCreate: jest.fn(), onIgnore: jest.fn() });
    expect(cfg.htmlContent).toContain('&lt;img src=x&gt;');
    expect(cfg.htmlContent).not.toContain('<img src=x>');
  });

  it('returns false and changes nothing when SP dialogs are unavailable', async () => {
    const onCreate = jest.fn();
    const shown = await showCreateProjectDialog('New', { onCreate, onIgnore: jest.fn() });
    expect(shown).toBe(false);
    expect(onCreate).not.toHaveBeenCalled();
  });
});
