import { INBOX_PROJECT_ID } from '../daily/daily-plan';

/**
 * Checked tasks in the Inbox file. When the setting is on, a task that is done in SP is
 * left out of the Inbox file, so the file does not fill up. Its line is removed when the
 * file is written. The task itself is never deleted: done tasks are left out of both
 * sides of the diff, so a missing line is not read as a delete. A line checked in the file
 * still marks its SP task done. Off by default (vault setting `inboxRemoveDone`).
 */
let enabled = false;

/** Set from the vault setting. Called at each sync start, before any sync runs. */
export const setInboxRemoveDone = (on: boolean): void => {
  enabled = on;
};

/** True when done tasks of this project are removed from their file. */
export const removesDone = (projectId: string): boolean => enabled && projectId === INBOX_PROJECT_ID;
