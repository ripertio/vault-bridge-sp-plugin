import { DailyNoteCfg, ensureToDosSection, findToDosSection } from './daily-note';

// Inbox project ID observed in live SP task data (getTasks), not yet documented.
export const INBOX_PROJECT_ID = 'INBOX_PROJECT';

const isInbox = (projectId: string | null): boolean =>
  projectId === null || projectId === INBOX_PROJECT_ID;

export interface DailyPlanTask {
  id: string;
  title: string;
  isDone: boolean;
  projectId: string | null;
}

export interface DailyPlanResult {
  // Tasks planned for today that are not yet in the note's ## To Dos section.
  missingTaskIds: string[];
  // The note lines that would be written. Equal to the input when nothing changes.
  nextLines: string[];
  // Human-readable lines for the dry-run log.
  logLines: string[];
}

/**
 * Compute what the daily note would look like. Pure: reads nothing and writes
 * nothing. Only task IDs and titles are used; a task is never removed here.
 */
export const planDailyNote = (
  cfg: DailyNoteCfg,
  lines: string[],
  plannedTasks: DailyPlanTask[],
): DailyPlanResult => {
  const planned = plannedTasks.filter((t) => cfg.includeInbox || !isInbox(t.projectId));
  const withSection = ensureToDosSection(lines);
  const section = findToDosSection(withSection);
  const bodyText = section ? withSection.slice(section.bodyStart, section.bodyEnd).join('\n') : '';

  const missing = planned.filter((t) => !bodyText.includes(`<!--${t.id}-->`));
  const newLines = missing.map((t) => `- [${t.isDone ? 'x' : ' '}] <!--${t.id}--> ${t.title}`);

  const nextLines = [...withSection];
  if (section && newLines.length > 0) {
    // Insert after the last non-blank body line so trailing blank lines stay put.
    let insertAt = section.bodyEnd;
    while (insertAt > section.bodyStart && withSection[insertAt - 1].trim() === '') {
      insertAt--;
    }
    nextLines.splice(insertAt, 0, ...newLines);
  }

  const logLines = [
    `would add ${missing.length} task(s) to ## To Dos`,
    ...missing.map((t) => `  + ${t.id} ${t.title}`),
  ];

  return {
    missingTaskIds: missing.map((t) => t.id),
    nextLines,
    logLines,
  };
};
