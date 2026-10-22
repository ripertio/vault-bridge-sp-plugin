import { showRenameDialog } from '../rename-dialog';

jest.mock('../../../shared/logger', () => ({ log: { log: jest.fn(), error: jest.fn() } }));

type Button = { label: string; onClick?: () => void | Promise<void> };
type Cfg = { htmlContent?: string; buttons?: Button[] };

const g = globalThis as unknown as { PluginAPI: Record<string, unknown> };

const handlers = () => ({ onRename: jest.fn(), onIgnore: jest.fn() });

describe('showRenameDialog', () => {
  afterEach(() => {
    delete g.PluginAPI.openDialog;
  });

  it('offers Rename, Ignore and Keep for now', async () => {
    const openDialog = jest.fn(async (_cfg: Cfg) => undefined);
    g.PluginAPI.openDialog = openDialog;
    const shown = await showRenameDialog('folder', 'Old', 'New', handlers());
    expect(shown).toBe(true);
    const labels = openDialog.mock.calls[0][0].buttons?.map((b) => b.label);
    expect(labels).toEqual(['Rename', 'Ignore', 'Keep for now']);
  });

  it('runs only the handler of the pressed button', async () => {
    const h = handlers();
    let cfg: Cfg = {};
    g.PluginAPI.openDialog = async (c: Cfg) => {
      cfg = c;
    };
    await showRenameDialog('project', 'Old', 'New', h);
    expect(h.onRename).not.toHaveBeenCalled();
    expect(h.onIgnore).not.toHaveBeenCalled();
    await cfg.buttons?.[1].onClick?.();
    expect(h.onIgnore).toHaveBeenCalledTimes(1);
    expect(h.onRename).not.toHaveBeenCalled();
    expect(cfg.buttons?.[2].onClick).toBeUndefined();
  });

  it('escapes the names in the HTML', async () => {
    let cfg: Cfg = {};
    g.PluginAPI.openDialog = async (c: Cfg) => {
      cfg = c;
    };
    await showRenameDialog('folder', '<b>x</b>', 'y', handlers());
    expect(cfg.htmlContent).toContain('&lt;b&gt;x&lt;/b&gt;');
  });

  it('returns false and renames nothing when SP dialogs are unavailable', async () => {
    const h = handlers();
    expect(await showRenameDialog('folder', 'Old', 'New', h)).toBe(false);
    expect(h.onRename).not.toHaveBeenCalled();
  });
});
