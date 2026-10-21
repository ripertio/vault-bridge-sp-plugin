import { DailyNoteCfg, findToDosSection } from './daily-note';

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
  // Existing lines whose checkbox was flipped to match SP.
  statusChangedTaskIds: string[];
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
  // Never create a heading for existing notes. Only a completely empty note gets
  // the ## To Dos heading, so the first write has a place to go.
  const isEmpty = lines.every((l) => l.trim() === '');
  const withSection = isEmpty ? ['## To Dos'] : [...lines];
  const section = findToDosSection(withSection);
  if (!section) {
    return {
      missingTaskIds: [],
      statusChangedTaskIds: [],
      nextLines: [...lines],
      logLines: ['## To Dos not found, nothing added'],
    };
  }
  const bodyText = withSection.slice(section.bodyStart, section.bodyEnd).join('\n');

  const missing = planned.filter((t) => !bodyText.includes(`<!--${t.id}-->`));
  const newLines = missing.map((t) => `- [${t.isDone ? 'x' : ' '}] <!--${t.id}--> ${t.title}`);

  const nextLines = [...withSection];

  // SP → Markdown only: flip the checkbox of an existing line to match SP's done
  // state. The rest of the line (title, notes, other lines) is left untouched.
  const statusChanged: string[] = [];
  {
    for (const t of planned) {
      const marker = `<!--${t.id}-->`;
      for (let i = section.bodyStart; i < section.bodyEnd; i++) {
        const line = nextLines[i];
        const match = /^(\s*[-*]\s*\[)([ xX])(\]\s*<!--)/.exec(line);
        if (!match || !line.includes(marker)) continue;
        const want = t.isDone ? 'x' : ' ';
        if (match[2].toLowerCase() !== want) {
          nextLines[i] = line.replace(/^(\s*[-*]\s*\[)([ xX])/, `$1${want}`);
          statusChanged.push(t.id);
        }
        break;
      }
    }
  }

  if (newLines.length > 0) {
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
    `would update ${statusChanged.length} checkbox(es)`,
    ...statusChanged.map((id) => `  ~ ${id}`),
  ];

  return {
    missingTaskIds: missing.map((t) => t.id),
    statusChangedTaskIds: statusChanged,
    nextLines,
    logLines,
  };
};
