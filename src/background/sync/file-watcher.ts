import { FILE_WATCH_POLL_INTERVAL_MS } from '../config.const';
import { lazySetInterval } from '../helper/lazy-set-interval';
import type { PluginNodeScriptError } from '@super-productivity/plugin-api';

interface NodeScriptResult {
  success: boolean;
  mtime?: string | null;
  error?: string;
}

const toErrMsg = (err: string | PluginNodeScriptError | undefined): string | undefined =>
  err === undefined ? undefined : typeof err === 'string' ? err : err.message;

export const startFileWatcher = (filePath: string, onChange: () => void): (() => void) => {
  // NOTE: no `if (!PluginAPI.executeNodeScript)` guard — SP binds it
  // unconditionally (off-desktop it resolves to { success: false }, which
  // getFileMtime turns into a caught error → the watcher simply reports no
  // change). The old guard was dead code.
  let lastMtime: Date | null = null;
  let initialMtimeResolved = false;

  // Get initial mtime
  getFileMtime(filePath)
    .then((mtime) => {
      lastMtime = mtime;
      initialMtimeResolved = true;
    })
    .catch(() => {
      lastMtime = null;
      initialMtimeResolved = true;
    });

  // Poll for changes
  const clearIntervalFn = lazySetInterval(async () => {
    if (!initialMtimeResolved) {
      return;
    }

    try {
      const currentMtime = await getFileMtime(filePath);
      if (lastMtime && currentMtime && currentMtime.getTime() !== lastMtime.getTime()) {
        lastMtime = currentMtime;
        onChange();
      } else if (!lastMtime && currentMtime) {
        lastMtime = currentMtime;
      }
    } catch (error) {
      lastMtime = null;
    }
  }, FILE_WATCH_POLL_INTERVAL_MS);

  return () => {
    if (clearIntervalFn) {
      clearIntervalFn();
    }
  };
};

const getFileMtime = async (filePath: string): Promise<Date | null> => {
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
    throw new Error(nodeResult?.error || toErrMsg(result.error) || 'Failed to get file stats');
  }

  return nodeResult.mtime ? new Date(nodeResult.mtime) : null;
};
