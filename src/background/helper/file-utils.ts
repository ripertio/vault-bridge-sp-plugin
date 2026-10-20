import type { PluginNodeScriptError } from '@super-productivity/plugin-api';

interface NodeScriptResult {
  success: boolean;
  content?: string | null;
  mtime?: string | null;
  error?: string;
}

/** Extract a plain string message from a `string | PluginNodeScriptError` value. */
const toErrorMessage = (err: string | PluginNodeScriptError | undefined): string | undefined =>
  err === undefined ? undefined : typeof err === 'string' ? err : err.message;

// NOTE: SP binds `executeNodeScript` unconditionally — off-desktop it resolves to
// `{ success: false }` (turned into a thrown error by each result check below)
// rather than being absent. So the old `if (!PluginAPI.executeNodeScript)` guards
// were dead code and have been removed; the `!` asserts the API type's optionality.

export const readTasksFile = async (filePath: string): Promise<string | null> => {
  const result = await PluginAPI.executeNodeScript!({
    script: `
      const fs = require('fs');
      const path = require('path');

      try {
        const absolutePath = path.resolve(args[0]);
        const content = fs.readFileSync(absolutePath, 'utf8');
        return { success: true, content };
      } catch (error) {
        if (error.code === 'ENOENT') {
          return { success: true, content: null };
        }
        return { success: false, error: error.message };
      }
    `,
    args: [filePath],
    timeout: 5000,
  });

  const nodeResult = result.result as NodeScriptResult;
  if (!result.success || !nodeResult?.success) {
    throw new Error(nodeResult?.error || toErrorMessage(result.error) || 'Failed to read file');
  }

  return nodeResult.content ?? null;
};

export const writeTasksFile = async (
  filePath: string,
  content: string,
): Promise<void> => {
  const result = await PluginAPI.executeNodeScript!({
    script: `
      const fs = require('fs');
      const path = require('path');

      try {
        const absolutePath = path.resolve(args[0]);
        const dirPath = path.dirname(absolutePath);

        // Ensure directory exists
        fs.mkdirSync(dirPath, { recursive: true });

        fs.writeFileSync(absolutePath, args[1], 'utf8');
        return { success: true };
      } catch (error) {
        return { success: false, error: error.message };
      }
    `,
    args: [filePath, content],
    timeout: 5000,
  });

  const nodeResult = result.result as NodeScriptResult;
  if (!result.success || !nodeResult?.success) {
    throw new Error(nodeResult?.error || toErrorMessage(result.error) || 'Failed to write file');
  }
};

export const getFileStats = async (filePath: string): Promise<{ mtime: Date } | null> => {
  const result = await PluginAPI.executeNodeScript!({
    script: `
      const fs = require('fs');
      const path = require('path');

      try {
        const absolutePath = path.resolve(args[0]);
        const stats = fs.statSync(absolutePath);
        return { success: true, mtime: stats.mtime.toISOString() };
      } catch (error) {
        if (error.code === 'ENOENT') {
          return { success: true, mtime: null };
        }
        return { success: false, error: error.message };
      }
    `,
    args: [filePath],
    timeout: 5000,
  });

  const nodeResult = result.result as NodeScriptResult;
  if (!result.success || !nodeResult?.success) {
    throw new Error(nodeResult?.error || toErrorMessage(result.error) || 'Failed to get file stats');
  }

  return nodeResult.mtime ? { mtime: new Date(nodeResult.mtime) } : null;
};

export const ensureDirectoryExists = async (filePath: string): Promise<void> => {
  const result = await PluginAPI.executeNodeScript!({
    script: `
      const fs = require('fs');
      const path = require('path');

      try {
        const absolutePath = path.resolve(args[0]);
        const dirPath = path.dirname(absolutePath);
        fs.mkdirSync(dirPath, { recursive: true });
        return { success: true };
      } catch (error) {
        return { success: false, error: error.message };
      }
    `,
    args: [filePath],
    timeout: 5000,
  });

  const nodeResult = result.result as NodeScriptResult;
  if (!result.success || !nodeResult?.success) {
    throw new Error(nodeResult?.error || toErrorMessage(result.error) || 'Failed to create directory');
  }
};
