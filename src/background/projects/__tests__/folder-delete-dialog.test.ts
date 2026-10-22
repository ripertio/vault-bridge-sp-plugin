import { showDeletedFolderDialog } from '../folder-delete-dialog';

jest.mock('../../../shared/logger', () => ({ log: { log: jest.fn(), error: jest.fn() } }));

type Button = { label: string; onClick?: () => void | Promise<void> };
type Cfg = { htmlContent?: string; buttons?: Button[] };

const g = globalThis as unknown as { PluginAPI: Record<string, unknown> };

describe('showDeletedFolderDialog', () => {
  afterEach(() => {
    delete g.PluginAPI.openDialog;
  });

  it('offers Unlink, Remove project and Keep for now', async () => {
    const openDialog = jest.fn(async (_cfg: Cfg) => undefined);
    g.PluginAPI.openDialog = openDialog;
    const shown = await showDeletedFolderDialog('Old', 'Old', { onUnlink: jest.fn(), onRemoveProject: jest.fn() });
    expect(shown).toBe(true);
    const labels = openDialog.mock.calls[0][0].buttons?.map((b) => b.label);
    expect(labels).toEqual(['Unlink', 'Remove project', 'Keep for now']);
  });

  it('runs only the handler of the pressed button', async () => {
    const onUnlink = jest.fn();
    const onRemoveProject = jest.fn();
    let cfg: Cfg = {};
    g.PluginAPI.openDialog = async (c: Cfg) => {
      cfg = c;
    };
    await showDeletedFolderDialog('Old', 'Old', { onUnlink, onRemoveProject });
    await cfg.buttons?.[0].onClick?.();
    expect(onUnlink).toHaveBeenCalledTimes(1);
    expect(onRemoveProject).not.toHaveBeenCalled();
    expect(cfg.buttons?.[2].onClick).toBeUndefined();
  });

  it('escapes the folder and project names in the HTML', async () => {
    let cfg: Cfg = {};
    g.PluginAPI.openDialog = async (c: Cfg) => {
      cfg = c;
    };
    await showDeletedFolderDialog('<img src=x>', '<b>T</b>', { onUnlink: jest.fn(), onRemoveProject: jest.fn() });
    expect(cfg.htmlContent).toContain('&lt;img src=x&gt;');
    expect(cfg.htmlContent).toContain('&lt;b&gt;T&lt;/b&gt;');
    expect(cfg.htmlContent).not.toContain('<img');
  });

  it('shows nothing and reports false when openDialog is unavailable', async () => {
    const shown = await showDeletedFolderDialog('Old', 'Old', { onUnlink: jest.fn(), onRemoveProject: jest.fn() });
    expect(shown).toBe(false);
  });
});
