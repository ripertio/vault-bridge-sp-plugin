import type { Task } from '@super-productivity/plugin-api';
import { readTasksFile } from '../helper/file-utils';
import { parseMarkdown, parseMarkdownGroup } from './markdown-parser';
import { SyncBindingCfg } from '../local-config';
import { removesDone } from './inbox-done';

export interface SyncVerificationResult {
  isInSync: boolean;
  differences: SyncDifference[];
}

export interface SyncDifference {
  type: 'missing-in-md' | 'missing-in-sp' | 'order-mismatch' | 'property-mismatch';
  taskId?: string;
  message: string;
  details?: any;
}

/**
 * Verifies that the state between Super Productivity and markdown file is in sync
 * Returns true if in sync, false otherwise with details about differences
 */
export const verifySyncState = async (
  config: SyncBindingCfg,
  // Every file of the project, main first, when the project has more than one.
  groupContents?: string[],
): Promise<SyncVerificationResult> => {
  const differences: SyncDifference[] = [];

  try {
    // Get tasks from SP
    const allTasks = await PluginAPI.getTasks();
    const projects = await PluginAPI.getAllProjects();
    const project = projects.find((p) => p.id === config.projectId);
    const spTasks = allTasks.filter((task) => task.projectId === config.projectId);

    // Get tasks from markdown
    const mdContent = groupContents ? groupContents.join('\n') : await readTasksFile(config.filePath);
    if (!mdContent) {
      if (spTasks.length > 0) {
        differences.push({
          type: 'missing-in-md',
          message: `Markdown file is empty but SP has ${spTasks.length} tasks`,
        });
      }
      return { isInSync: differences.length === 0, differences };
    }

    const mdTasks = groupContents ? parseMarkdownGroup(groupContents).tasks : parseMarkdown(mdContent);

    // Create maps for quick lookup
    const spTaskMap = new Map<string, Task>();
    const mdTaskMap = new Map<string, (typeof mdTasks)[0]>();

    mdTasks.forEach((task) => {
      if (task.id) {
        mdTaskMap.set(task.id, task);
      }
    });

    // The Inbox file leaves out done tasks (inbox-done.ts), so one without a line is no
    // difference. A done task whose line is still in the file is compared as usual.
    const dropDone = removesDone(config.projectId);
    spTasks.forEach((task) => {
      if (task.id && !(dropDone && task.isDone && !mdTaskMap.has(task.id))) {
        spTaskMap.set(task.id, task);
      }
    });

    // Check for tasks missing in markdown
    for (const [taskId, spTask] of spTaskMap) {
      if (!mdTaskMap.has(taskId)) {
        differences.push({
          type: 'missing-in-md',
          taskId,
          message: `Task "${spTask.title}" exists in SP but not in markdown`,
        });
      }
    }

    // Check for tasks missing in SP
    for (const [taskId, mdTask] of mdTaskMap) {
      if (!spTaskMap.has(taskId)) {
        differences.push({
          type: 'missing-in-sp',
          taskId,
          message: `Task "${mdTask.title}" exists in markdown but not in SP`,
        });
      }
    }

    // Check property matches for tasks that exist in both
    for (const [taskId, mdTask] of mdTaskMap) {
      const spTask = spTaskMap.get(taskId);
      if (spTask) {
        // Check title
        if (spTask.title !== mdTask.title) {
          differences.push({
            type: 'property-mismatch',
            taskId,
            message: `Title mismatch for task ${taskId}`,
            details: { sp: spTask.title, md: mdTask.title },
          });
        }

        // Check completion status
        if (spTask.isDone !== mdTask.completed) {
          differences.push({
            type: 'property-mismatch',
            taskId,
            message: `Completion status mismatch for task "${spTask.title}"`,
            details: { sp: spTask.isDone, md: mdTask.completed },
          });
        }

        // Check parent relationship (treat null and undefined as equivalent)
        const spParentId = spTask.parentId || null;
        const mdParentId = mdTask.parentId || null;
        if (spParentId !== mdParentId) {
          differences.push({
            type: 'property-mismatch',
            taskId,
            message: `Parent ID mismatch for task "${spTask.title}"`,
            details: { sp: spTask.parentId, md: mdTask.parentId },
          });
        }

        // Check notes
        const spNotes = spTask.notes?.trim() || '';
        const mdNotes = mdTask.notes?.trim() || '';
        if (spNotes !== mdNotes) {
          differences.push({
            type: 'property-mismatch',
            taskId,
            message: `Notes mismatch for task "${spTask.title}"`,
            details: { sp: spNotes, md: mdNotes },
          });
        }
      }
    }

    // Check task order
    const mdParentTasks = mdTasks.filter((t) => !t.parentId);

    // If project has taskIds, use them for ordering
    if (project && project.taskIds && project.taskIds.length > 0) {
      const orderedSpTaskIds = project.taskIds.filter((id) => {
        const task = spTaskMap.get(id);
        return task && !task.parentId;
      });

      const mdParentTaskIds = mdParentTasks.map((t) => t.id).filter((id) => id);

      const parentOrderChanged =
        orderedSpTaskIds.length !== mdParentTaskIds.length ||
        orderedSpTaskIds.some((id, index) => id !== mdParentTaskIds[index]);

      if (parentOrderChanged) {
        differences.push({
          type: 'order-mismatch',
          message: 'Parent task order mismatch',
          details: { sp: orderedSpTaskIds, md: mdParentTaskIds },
        });
      }
    }

    // Check subtask order
    for (const [taskId, spTask] of spTaskMap) {
      if (spTask.subTaskIds && spTask.subTaskIds.length > 0) {
        const mdTask = mdTaskMap.get(taskId);
        if (mdTask) {
          // Get actual subtask IDs from markdown in the order they appear
          // Sort by line number to maintain the order from the file
          const mdSubtaskIds = mdTasks
            .filter((t) => t.parentId === taskId)
            .sort((a, b) => a.line - b.line)
            .map((t) => t.id)
            .filter((id) => id);

          const spSubtaskIds = spTask.subTaskIds.filter((id) => spTaskMap.has(id));

          const subtaskOrderChanged =
            spSubtaskIds.length !== mdSubtaskIds.length ||
            spSubtaskIds.some((id, index) => id !== mdSubtaskIds[index]);

          if (subtaskOrderChanged) {
            differences.push({
              type: 'order-mismatch',
              taskId,
              message: `Subtask order mismatch for task "${spTask.title}"`,
              details: { sp: spSubtaskIds, md: mdSubtaskIds },
            });
          }
        }
      }
    }

    return {
      isInSync: differences.length === 0,
      differences,
    };
  } catch (error) {
    console.error('Error verifying sync state:', error);
    return {
      isInSync: false,
      differences: [
        {
          type: 'property-mismatch',
          message: `Error during verification: ${error}`,
        },
      ],
    };
  }
};

/**
 * Logs the sync verification result
 */
export const logSyncVerification = (
  result: SyncVerificationResult,
  context: string,
): void => {
  if (!result.isInSync) {
    console.log(`❌ Sync verification failed: ${context}`);
    console.log(`Found ${result.differences.length} differences:`);
    result.differences.forEach((diff) => {
      console.log(`  - ${diff.type}: ${diff.message}`);
      if (diff.details) {
        // For order mismatches, show the actual arrays for better debugging
        if (diff.type === 'order-mismatch' && diff.details.sp && diff.details.md) {
          console.log(`    SP order: [${diff.details.sp.join(', ')}]`);
          console.log(`    MD order: [${diff.details.md.join(', ')}]`);
        } else {
          console.log(`    Details:`, diff.details);
        }
      }
    });
  }
};
