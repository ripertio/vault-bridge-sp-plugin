import { showRenameDialog } from '../rename-dialog';

jest.mock('../../../shared/logger', () => ({ log: { log: jest.fn(), error: jest.fn() } }));

type Button = { label: string; onClick?: () => void | Promise<void> };
type Cfg = { htmlContent?: string; buttons?: Button[] };

const g = globalThis as unknown as { PluginAPI: Record<string, unknown> };

describe('showRenameDialog', () => {
  afterEach(() => {
    delete g.PluginAPI.openDialog;
  });

  it('offers Rename and Keep for now', async () => {
    const openDialog = jest.fn(async (_cfg: Cfg) => undefined);
    g.PluginAPI.openDialog = openDialog;
    const shown = await showRenameDialog('folder', 'Old', 'New', jest.fn());
    expect(shown).toBe(true);
    const labels = openDialog.mock.calls[0][0].buttons?.map((b) => b.label);
    expect(labels).toEqual(['Rename', 'Keep for now']);
  });

  it('runs the rename only when Rename is pressed', async () => {
    const onRename = jest.fn();
    let cfg: Cfg = {};
    g.PluginAPI.openDialog = async (c: Cfg) => {
      cfg = c;
    };
    await showRenameDialog('project', 'Old', 'New', onRename);
    expect(onRename).not.toHaveBeenCalled();
    await cfg.buttons?.[0].onClick?.();
    expect(onRename).toHaveBeenCalledTimes(1);
    expect(cfg.buttons?.[1].onClick).toBeUndefined();
  });

  it('escapes the names in the HTML', async () => {
    let cfg: Cfg = {};
    g.PluginAPI.openDialog = async (c: Cfg) => {
      cfg = c;
    };
    await showRenameDialog('folder', '<b>x</b>', 'y', jest.fn());
    expect(cfg.htmlContent).toContain('&lt;b&gt;x&lt;/b&gt;');
  });

  it('returns false and renames nothing when SP dialogs are unavailable', async () => {
    const onRename = jest.fn();
    expect(await showRenameDialog('folder', 'Old', 'New', onRename)).toBe(false);
    expect(onRename).not.toHaveBeenCalled();
  });
});
