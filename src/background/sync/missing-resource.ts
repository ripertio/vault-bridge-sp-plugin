import { log } from '../../shared/logger';

/**
 * Interactive dialogs for the "missing resource" policy (see CLAUDE.md → Pending
 * work). A binding must never limp along broken ("cojo"): when a sync finds a
 * required resource gone, the user is forced to resolve it through a modal.
 *
 * The SP plugin API has no snack-with-buttons (`showSnack` is passive), so we
 * use `openDialog`, which SP 18.13.1 supports (verified 2026-07-06). `openDialog`
 * / `addProject` are not in the `^1.0.1` API types, so they are feature-detected
 * through a narrow local cast rather than declared on PluginAPI.
 */
interface DialogButton {
  label: string;
  icon?: string;
  color?: 'primary' | 'warn';
  onClick: () => void | Promise<void>;
}

interface OpenDialogApi {
  openDialog?: (cfg: {
    htmlContent?: string;
    buttons?: DialogButton[];
  }) => Promise<void>;
}

interface AddProjectApi {
  addProject?: (data: { title: string }) => Promise<string>;
}

/**
 * Create a new SP project and return its id. Feature-detected: `addProject` is
 * not in the `^1.0.1` API types but works on SP 18.13.1 (verified 2026-07-06).
 * Throws if unavailable so the caller can fall back to "delete binding".
 */
export const createSpProject = async (title: string): Promise<string> => {
  const api = PluginAPI as unknown as AddProjectApi;
  if (typeof api.addProject !== 'function') {
    throw new Error('addProject is not available in this SP version');
  }
  return api.addProject({ title });
};

/** Escape a string for safe interpolation into the dialog's htmlContent. */
const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/**
 * Handlers for the "`.md` file not found" dialog. Exactly one runs, depending on
 * which button the user clicks; if `openDialog` is unavailable the dialog falls
 * back to `onRecreate` (the least-destructive default) so the plugin still works.
 */
export interface MissingFileHandlers {
  onRecreate: () => void | Promise<void>;
  onDelete: () => void | Promise<void>;
  onIgnore?: () => void | Promise<void>;
}

/**
 * Show the "`.md` file not found" dialog (3 buttons: Recreate from SP / Delete
 * binding / Ignore). Resolves after the user has chosen and the chosen handler
 * has run. Never rejects — errors are logged and surfaced via snack.
 */
export const showMissingFileDialog = async (
  filePath: string,
  handlers: MissingFileHandlers,
): Promise<void> => {
  const api = PluginAPI as unknown as OpenDialogApi;

  if (typeof api.openDialog !== 'function') {
    // No dialog support — fall back to the least-destructive default so a broken
    // API can't leave the binding stuck. Recreate from SP is safe (data lives in
    // SP); it just skips the user's choice.
    log.error('[vault-bridge] openDialog unavailable — recreating file from SP by default');
    await handlers.onRecreate();
    return;
  }

  try {
    await api.openDialog({
      htmlContent:
        '<h3>Vault Bridge — file not found</h3>' +
        `<p>The Markdown file <code>${escapeHtml(filePath)}</code> could not be found ` +
        'when syncing. A binding cannot continue without its file — please choose:</p>' +
        '<ul>' +
        '<li><strong>Recreate from SP</strong> — regenerate the file from the current project.</li>' +
        '<li><strong>Delete binding</strong> — remove this binding.</li>' +
        '<li><strong>Ignore</strong> — if you can restore the file yourself, do it and this dialog will reappear on the next sync if it is still missing.</li>' +
        '</ul>',
      buttons: [
        {
          label: 'Recreate from SP',
          color: 'primary',
          onClick: () => handlers.onRecreate(),
        },
        {
          label: 'Delete binding',
          color: 'warn',
          onClick: () => handlers.onDelete(),
        },
        {
          label: 'Ignore',
          onClick: () => handlers.onIgnore?.(),
        },
      ],
    });
  } catch (err) {
    log.error('[vault-bridge] showMissingFileDialog failed:', err);
    PluginAPI.showSnack({
      msg: `Vault Bridge: could not show the missing-file dialog for "${filePath}".`,
      type: 'ERROR',
    });
  }
};

/**
 * Handlers for the "SP project deleted" dialog: recreate the project (plugin
 * re-points the binding to the new id), delete the binding, or ignore (the user
 * will create a project and re-point the binding themselves via the config panel
 * — the one valid external fix, since recreating by hand yields a new id).
 */
export interface MissingProjectHandlers {
  onRecreate: () => void | Promise<void>;
  onDelete: () => void | Promise<void>;
  /**
   * "Delete + clean file": delete the binding AND strip the `<!--taskId-->`
   * markers from the `.md` so it is left neutral. Only offered when the file
   * still exists (`canRecreate`), mirroring the config-panel delete. Optional so
   * callers/tests can omit it.
   */
  onDeleteAndClean?: () => void | Promise<void>;
  onIgnore: () => void | Promise<void>;
}

/**
 * Show the "SP project deleted" dialog. Buttons: Recreate project in SP (only
 * when the `.md` still exists, as its source), Delete binding, and Ignore.
 * `canRecreate` carries whether the file survives. Resolves after the chosen
 * handler runs; never rejects.
 */
export const showMissingProjectDialog = async (
  filePath: string,
  handlers: MissingProjectHandlers,
  canRecreate: boolean,
  projectTitle?: string,
): Promise<void> => {
  const api = PluginAPI as unknown as OpenDialogApi;

  if (typeof api.openDialog !== 'function') {
    // No dialog support — least-destructive default: recreate if we can (the
    // `.md` survives, so restoring the project is safe), otherwise delete.
    log.error('[vault-bridge] openDialog unavailable — resolving missing-project by default');
    if (canRecreate) await handlers.onRecreate();
    else await handlers.onDelete();
    return;
  }

  const canClean = canRecreate && typeof handlers.onDeleteAndClean === 'function';

  const buttons: DialogButton[] = [];
  if (canRecreate) {
    buttons.push({
      label: 'Recreate project in SP',
      color: 'primary',
      onClick: () => handlers.onRecreate(),
    });
  }
  buttons.push({
    label: 'Delete binding',
    color: 'warn',
    onClick: () => handlers.onDelete(),
  });
  if (canClean) {
    buttons.push({
      label: 'Delete + clean file',
      color: 'warn',
      onClick: () => handlers.onDeleteAndClean!(),
    });
  }
  buttons.push({
    label: 'Ignore',
    onClick: () => handlers.onIgnore(),
  });

  const recreateLine = canRecreate
    ? '<li><strong>Recreate project in SP</strong> — create a new project from this file and re-point the binding to it.</li>'
    : '';
  const cleanLine = canClean
    ? '<li><strong>Delete + clean file</strong> — remove this binding and strip the hidden sync markers (<code>&lt;!--…--&gt;</code>) from the file, leaving it neutral.</li>'
    : '';
  const noSourceNote = canRecreate
    ? ''
    : '<p><em>The Markdown file is also missing, so the project cannot be recreated — delete the binding, or ignore and fix it yourself.</em></p>';

  const projectRef = projectTitle
    ? `<strong>${escapeHtml(projectTitle)}</strong> (bound to <code>${escapeHtml(filePath)}</code>)`
    : `the project bound to <code>${escapeHtml(filePath)}</code>`;

  try {
    await api.openDialog({
      htmlContent:
        '<h3>Vault Bridge — project not found</h3>' +
        `<p>The Super Productivity project ${projectRef} ` +
        'no longer exists. A deleted project cannot be fixed by hand (a new one gets a ' +
        'different id), so please choose:</p>' +
        '<ul>' +
        recreateLine +
        '<li><strong>Delete binding</strong> — remove this binding (the file keeps its hidden sync markers).</li>' +
        cleanLine +
        '<li><strong>Ignore</strong> — if you will create a project yourself and re-point this binding to it (in the config panel), choose this; the dialog returns on the next sync if the project is still missing.</li>' +
        '</ul>' +
        noSourceNote,
      buttons,
    });
  } catch (err) {
    log.error('[vault-bridge] showMissingProjectDialog failed:', err);
    PluginAPI.showSnack({
      msg: `Vault Bridge: could not show the missing-project dialog for "${filePath}".`,
      type: 'ERROR',
    });
  }
};
