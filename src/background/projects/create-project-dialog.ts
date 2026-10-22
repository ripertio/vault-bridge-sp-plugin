import { log } from '../../shared/logger';

/**
 * The "new folder has no project" dialog. Three choices: create the SP project, ignore
 * the folder (it is added to the excluded list and never asked about again), or keep it
 * for now (the question comes back after a restart). No project is created unless the
 * user presses Create.
 *
 * `openDialog` is not in the `^1.0.1` API types, so it is feature-detected through a
 * narrow local cast, the same way folder-delete-dialog.ts does it. Its promise resolves
 * when the dialog is shown, not when a button is pressed, so the handlers run from the
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

export interface CreateProjectHandlers {
  onCreate: () => void | Promise<void>;
  onIgnore: () => void | Promise<void>;
}

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Show the dialog for one folder without a project. Returns false when SP dialogs are
 * not available; the caller then creates nothing.
 */
export const showCreateProjectDialog = async (
  folder: string,
  handlers: CreateProjectHandlers,
): Promise<boolean> => {
  const api = PluginAPI as unknown as OpenDialogApi;
  if (typeof api.openDialog !== 'function') {
    log.error(`openDialog unavailable — folder "${folder}" left without a project`);
    return false;
  }

  await api.openDialog({
    htmlContent:
      '<h3>sync.md Multi — new folder</h3>' +
      `<p>The folder <code>${escapeHtml(folder)}</code> in the projects folder has no ` +
      'Super Productivity project with the same name. Please choose:</p>' +
      '<ul>' +
      `<li><strong>Create</strong> — create the project <strong>${escapeHtml(folder)}</strong> in Super Productivity.</li>` +
      '<li><strong>Ignore</strong> — leave this folder out of sync. It is not asked about again.</li>' +
      '</ul>' +
      '<p>Keep for now — the question comes back after a restart.</p>',
    buttons: [
      { label: 'Create', color: 'primary', onClick: handlers.onCreate },
      { label: 'Ignore', onClick: handlers.onIgnore },
      { label: 'Keep for now' },
    ],
  });
  return true;
};
