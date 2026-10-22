import { log } from '../../shared/logger';

/**
 * The "SP project has no folder" dialog. Three choices: create the folder and its task
 * file for the project, ignore the project (its name is added to the excluded list and
 * it is not asked about again), or keep it for now (the question comes back after a
 * restart). Nothing is created unless the user presses Create.
 *
 * `openDialog` is not in the `^1.0.1` API types, so it is feature-detected through a
 * narrow local cast, the same way create-project-dialog.ts does it.
 */
interface DialogButton {
  label: string;
  color?: 'primary' | 'warn';
  onClick?: () => void | Promise<void>;
}

interface OpenDialogApi {
  openDialog?: (cfg: { htmlContent?: string; buttons?: DialogButton[] }) => Promise<void>;
}

export interface CreateFolderHandlers {
  onCreate: () => void | Promise<void>;
  onIgnore: () => void | Promise<void>;
}

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Show the dialog for one project without a folder. Returns false when SP dialogs are
 * not available; the caller then creates nothing.
 */
export const showCreateFolderDialog = async (
  projectTitle: string,
  taskFileName: string,
  handlers: CreateFolderHandlers,
): Promise<boolean> => {
  const api = PluginAPI as unknown as OpenDialogApi;
  if (typeof api.openDialog !== 'function') {
    log.error(`openDialog unavailable — project "${projectTitle}" left without a folder`);
    return false;
  }

  await api.openDialog({
    htmlContent:
      '<h3>sync.md Multi — new folder</h3>' +
      `<p>The Super Productivity project <strong>${escapeHtml(projectTitle)}</strong> has no ` +
      'folder in the projects folder. Please choose:</p>' +
      '<ul>' +
      `<li><strong>Create</strong> — create the folder and a <code>${escapeHtml(taskFileName)}</code> for it.</li>` +
      '<li><strong>Ignore</strong> — leave this project out of sync. It is not asked about again.</li>' +
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
