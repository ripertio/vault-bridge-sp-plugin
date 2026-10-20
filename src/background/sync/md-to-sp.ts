import { parseMarkdownWithHeader } from './markdown-parser';
import { generateTaskOperations } from './generate-task-operations';
// import { Task } from '@super-productivity/plugin-api';

/**
 * Run one batch of operations through SP and throw on failure.
 * Extracted so mdToSp can issue two ordered batches (see below).
 */
const applyBatch = async (
  projectId: string,
  operations: ReturnType<typeof generateTaskOperations>,
): Promise<void> => {
  if (operations.length === 0) return;
  const result = await PluginAPI.batchUpdateForProject!({ projectId, operations });
  if (!result.success && result.errors && result.errors.length > 0) {
    const errorSummary = result.errors
      .map((e) => `Op ${e.operationIndex}: ${e.message}`)
      .slice(0, 3)
      .join('; ');
    throw new Error(`Batch operations failed: ${errorSummary}`);
  }
};

/**
 * Result of an MD → SP import attempt:
 *   - `'ok'`          — the import ran (operations applied, or none needed).
 *   - `'parse-error'` — the file could not be fully parsed, so NOTHING was
 *                       touched in SP. Callers MUST also skip the SP → MD
 *                       write-back: writing back would overwrite the user's
 *                       in-progress (malformed) edit with stale SP state.
 */
export type MdToSpResult = 'ok' | 'parse-error';

/**
 * Replicate markdown content to Super Productivity tasks
 * Uses the new generateTaskOperations function for proper bidirectional sync
 */
export const mdToSp = async (
  markdownContent: string,
  projectId: string,
): Promise<MdToSpResult> => {
  try {
    // Parse markdown with error tracking
    const parseResult = parseMarkdownWithHeader(markdownContent);
    const parsedTasks = parseResult.tasks;

    // Abort on any parse error, BEFORE touching SP. A parse error means we could
    // not fully understand the file, and reconciliation treats the parsed set as
    // authoritative: it would DELETE every SP task not present in it. A line like
    // `- [ ] <!--A-->` (empty title) is reported as an error and skipped, so
    // continuing would delete task A despite the warning. Returning here leaves
    // SP untouched; the next sync retries once the file is valid.
    if (parseResult.errors && parseResult.errors.length > 0) {
      const errorMsg = `Found ${parseResult.errors.length} issue(s) in markdown:\n${parseResult.errors.slice(0, 3).join('\n')}`;
      console.warn('[sync-md]', errorMsg);

      PluginAPI.showSnack({
        msg: `Sync.md: ${parseResult.errors.length} parsing issue(s) — import skipped to protect your tasks. Check console for details.`,
        type: 'WARNING',
      });
      return 'parse-error';
    }

    // Get current state
    const currentTasks = await PluginAPI.getTasks();
    const currentProjects = await PluginAPI.getAllProjects();

    if (!currentProjects.find((p) => p.id === projectId)) {
      throw new Error(`Project ${projectId} not found`);
    }

    // Filter tasks for the specific project
    const projectTasks = currentTasks.filter((task) => task.projectId === projectId);

    // Generate operations with validation
    const operations = generateTaskOperations(parsedTasks, projectTasks, projectId);

    // Execute in two ordered phases so a deleted parent never cascades onto a
    // promoted child. SP's batch reducer resolves a `delete` against the
    // subTaskIds it sees at the *start* of the batch: if we delete a parent P
    // in the same batch that re-parents its child C to root, the reducer still
    // reads P.subTaskIds = [C] and recursively deletes C along with P.
    // Splitting the deletes into a second, separate batch means the
    // re-parenting update (which empties P.subTaskIds) is already committed
    // before P is deleted, so the reducer sees P.subTaskIds = [] and C survives.
    //
    // Non-delete ops (create/update/reorder) stay together in the first batch:
    // `reorder` references the temp ids that `create` mints within the same
    // batch, so they must not be separated.
    const deleteOps = operations.filter((op) => op.type === 'delete');
    const nonDeleteOps = operations.filter((op) => op.type !== 'delete');

    await applyBatch(projectId, nonDeleteOps);
    await applyBatch(projectId, deleteOps);
    return 'ok';
  } catch (error) {
    console.error('[sync-md] Error in mdToSp:', error);

    // Show user-friendly error notification
    PluginAPI.showSnack({
      msg: `Sync.md: Failed to sync markdown to SP. ${error instanceof Error ? error.message : 'Unknown error'}`,
      type: 'ERROR',
    });

    // Re-throw to allow caller to handle if needed
    throw error;
  }
};
