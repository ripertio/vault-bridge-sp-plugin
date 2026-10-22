import { log } from '../../shared/logger';

/**
 * The rename approval dialog. Three choices: Rename (the folder or the SP project, to
 * match the other side), Ignore (keep both names and link them as they are), or Keep
 * for now (nothing changes; the question comes back after a restart). Nothing is
 * renamed unless the user presses Rename.
 *
 * `openDialog` is not in the `^1.0.1` API types, so it is feature-detected through a
 * narrow local cast, the same way folder-delete-dialog.ts does it. Its promise resolves
 * when the dialog is shown, not when a button is pressed, so the handler runs from the
 * button `onClick` and nothing waits on the promise.
 */
interface DialogButton {
  label: string;
  color?: 'primary' | 'warn';
  onClick?: () => void | Promise<void>;
}

interface OpenDialogApi {
  openDialog?: (cfg: { htmlContent?: string; buttons?: DialogButton[] }) => Promise<void>;
}

export type RenameKind = 'folder' | 'project';

export interface RenameHandlers {
  onRename: () => void | Promise<void>;
  onIgnore: () => void | Promise<void>;
}

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Show the dialog for one pending rename. Returns false when SP dialogs are not
 * available; the caller then renames nothing.
 */
export const showRenameDialog = async (
  kind: RenameKind,
  from: string,
  to: string,
  handlers: RenameHandlers,
): Promise<boolean> => {
  const api = PluginAPI as unknown as OpenDialogApi;
  if (typeof api.openDialog !== 'function') {
    log.error(`openDialog unavailable — rename of "${from}" to "${to}" not applied`);
    return false;
  }

  const what =
    kind === 'folder'
      ? `the folder <code>${escapeHtml(from)}</code> to <code>${escapeHtml(to)}</code> in the projects folder`
      : `the Super Productivity project <strong>${escapeHtml(from)}</strong> to <strong>${escapeHtml(to)}</strong>`;

  await api.openDialog({
    htmlContent:
      '<h3>sync.md Multi — rename</h3>' +
      `<p>A rename was detected. Rename ${what}?</p>` +
      '<p>Ignore — keep both names and link them as they are. The question is not asked again.</p>' +
      '<p>Keep for now — the question comes back after a restart.</p>',
    buttons: [
      { label: 'Rename', color: 'primary', onClick: handlers.onRename },
      { label: 'Ignore', onClick: handlers.onIgnore },
      { label: 'Keep for now' },
    ],
  });
  return true;
};
