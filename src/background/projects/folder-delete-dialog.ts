import { log } from '../../shared/logger';

/**
 * The "linked folder was deleted" dialog. Three choices: unlink the project, remove
 * the project from Super Productivity, or keep it for now (the question is asked
 * again after a restart). Nothing is removed unless the user presses Remove.
 *
 * `openDialog` is not in the `^1.0.1` API types, so it is feature-detected through a
 * narrow local cast, the same way missing-resource.ts does it. Its promise resolves
 * when the dialog is shown, not when a button is pressed, so the handlers run from
 * the button `onClick` and nothing waits on the promise.
 */
interface DialogButton {
  label: string;
  color?: 'primary' | 'warn';
  onClick?: () => void | Promise<void>;
}

interface OpenDialogApi {
  openDialog?: (cfg: { htmlContent?: string; buttons?: DialogButton[] }) => Promise<void>;
}

export interface DeletedFolderHandlers {
  onUnlink: () => void | Promise<void>;
  onRemoveProject: () => void | Promise<void>;
}

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Show the dialog for one deleted folder. Returns false when SP dialogs are not
 * available; the caller then leaves the project alone.
 */
export const showDeletedFolderDialog = async (
  folder: string,
  projectTitle: string,
  handlers: DeletedFolderHandlers,
): Promise<boolean> => {
  const api = PluginAPI as unknown as OpenDialogApi;
  if (typeof api.openDialog !== 'function') {
    log.error(`openDialog unavailable — folder "${folder}" deleted, project "${projectTitle}" left unchanged`);
    return false;
  }

  await api.openDialog({
    htmlContent:
      '<h3>sync.md Multi — folder deleted</h3>' +
      `<p>The folder <code>${escapeHtml(folder)}</code> was deleted from the projects folder. ` +
      `Its project <strong>${escapeHtml(projectTitle)}</strong> still exists in Super Productivity. ` +
      'Please choose:</p>' +
      '<ul>' +
      '<li><strong>Unlink</strong> — keep the project. No folder is created for it again.</li>' +
      '<li><strong>Remove project</strong> — delete the project and its tasks in Super Productivity.</li>' +
      '</ul>' +
      '<p>Keep for now — the question comes back after a restart.</p>',
    buttons: [
      { label: 'Unlink', color: 'primary', onClick: handlers.onUnlink },
      { label: 'Remove project', color: 'warn', onClick: handlers.onRemoveProject },
      { label: 'Keep for now' },
    ],
  });
  return true;
};
