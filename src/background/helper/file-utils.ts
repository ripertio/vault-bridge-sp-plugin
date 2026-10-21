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

/**
 * List the sub-folder names directly inside `dirPath`. Read-only. Returns [] when
 * the folder does not exist. Hidden entries (starting with '.') are skipped.
 */
export const listSubfolders = async (dirPath: string): Promise<string[]> => {
  const result = await PluginAPI.executeNodeScript!({
    script: `
      const fs = require('fs');
      const path = require('path');
      try {
        const dir = path.resolve(args[0]);
        const names = fs
          .readdirSync(dir, { withFileTypes: true })
          .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
          .map((e) => e.name);
        return { success: true, names };
      } catch (error) {
        if (error.code === 'ENOENT') return { success: true, names: [] };
        return { success: false, error: error.message };
      }
    `,
    args: [dirPath],
    timeout: 5000,
  });

  const nodeResult = result.result as { success: boolean; names?: string[]; error?: string } | undefined;
  if (!result.success || !nodeResult?.success) {
    throw new Error(nodeResult?.error || toErrorMessage(result.error) || 'Failed to list folders');
  }
  return nodeResult.names ?? [];
};

/**
 * Rename one folder directly inside `parentDir`. Both names must be plain folder
 * names (no separators or '..'), so the rename cannot leave `parentDir`. Fails if
 * the target already exists, so nothing is overwritten.
 */
export const renameSubfolder = async (
  parentDir: string,
  from: string,
  to: string,
): Promise<void> => {
  const plain = (n: string) => n.length > 0 && !/[\\/]/.test(n) && n !== '.' && n !== '..';
  if (!plain(from) || !plain(to)) throw new Error('invalid folder name');

  const result = await PluginAPI.executeNodeScript!({
    script: `
      const fs = require('fs');
      const path = require('path');
      try {
        const parent = path.resolve(args[0]);
        const src = path.join(parent, args[1]);
        const dst = path.join(parent, args[2]);
        if (path.dirname(src) !== parent || path.dirname(dst) !== parent) {
          return { success: false, error: 'rename escapes the projects folder' };
        }
        if (fs.existsSync(dst)) return { success: false, error: 'target exists' };
        fs.renameSync(src, dst);
        return { success: true };
      } catch (error) {
        return { success: false, error: error.message };
      }
    `,
    args: [parentDir, from, to],
    timeout: 5000,
  });

  const nodeResult = result.result as { success: boolean; error?: string } | undefined;
  if (!result.success || !nodeResult?.success) {
    throw new Error(nodeResult?.error || toErrorMessage(result.error) || 'rename failed');
  }
};
