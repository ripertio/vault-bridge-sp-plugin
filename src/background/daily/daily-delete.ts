import { log } from '../../shared/logger';

interface DialogApi {
  openDialog?: (cfg: {
    title?: string;
    htmlContent?: string;
    buttons?: { label: string; color?: 'primary' | 'warn'; onClick?: () => void | Promise<void> }[];
  }) => Promise<void>;
  deleteTask?: (taskId: string) => Promise<void>;
}

const escapeHtml = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

/**
 * Ask before deleting SP tasks whose lines were removed from the note. Nothing is
 * deleted unless the user presses the warn button. If the dialog or deleteTask is
 * not available, nothing is deleted. Returns the IDs actually deleted.
 */
export const confirmAndDeleteTasks = async (
  api: DialogApi,
  candidates: { id: string; title: string }[],
): Promise<string[]> => {
  if (candidates.length === 0) return [];
  if (typeof api.openDialog !== 'function' || typeof api.deleteTask !== 'function') {
    log.log(`${candidates.length} task(s) removed from the note, SP delete unavailable, kept`);
    return [];
  }

  const deleted: string[] = [];
  const items = candidates.map((c) => `<li>${escapeHtml(c.title)}</li>`).join('');
  await api.openDialog({
    title: 'Delete tasks in Super Productivity?',
    htmlContent:
      '<p>These lines were removed from the daily note. Delete the matching tasks in ' +
      'Super Productivity? This cannot be undone.</p><ul>' +
      items +
      '</ul>',
    buttons: [
      {
        label: 'Delete in SP',
        color: 'warn',
        onClick: async () => {
          for (const c of candidates) {
            try {
              await api.deleteTask!(c.id);
              deleted.push(c.id);
            } catch (err) {
              log.error(`delete failed for ${c.id}`, err);
            }
          }
        },
      },
      { label: 'Keep tasks' },
    ],
  });
  return deleted;
};
