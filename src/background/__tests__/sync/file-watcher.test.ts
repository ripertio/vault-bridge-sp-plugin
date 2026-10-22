import { startFileWatcher } from '../../sync/file-watcher';

// Set up Node.js environment for tests
if (typeof setImmediate === 'undefined') {
  (global as any).setImmediate = (fn: () => void) => setTimeout(fn, 0);
}

// Mock PluginAPI globally
(global as any).PluginAPI = {
  executeNodeScript: jest.fn(),
};

describe('File Watcher', () => {
  const mockFilePath = '/test/tasks.md';
  const mockCallback = jest.fn();
  let mockExecuteNodeScript: jest.Mock;
  let stopWatcher: (() => void) | null = null;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    // Setup mock for PluginAPI.executeNodeScript
    mockExecuteNodeScript = jest.fn();
    (global as any).PluginAPI = {
      executeNodeScript: mockExecuteNodeScript,
    };

    // Default mock implementation returns a file with mtime
    mockExecuteNodeScript.mockResolvedValue({
      success: true,
      result: {
        success: true,
        mtime: new Date('2024-01-01T00:00:00Z').toISOString(),
      },
    });
  });

  afterEach(() => {
    if (stopWatcher) {
      stopWatcher();
      stopWatcher = null;
    }
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  describe('startFileWatcher', () => {
    it('should start watching a file when it exists', async () => {
      stopWatcher = startFileWatcher(mockFilePath, mockCallback);

      // Should immediately check file mtime
      await Promise.resolve(); // Let promises resolve
      expect(mockExecuteNodeScript).toHaveBeenCalledWith({
        script: expect.stringContaining('fs.statSync'),
        args: [mockFilePath],
        timeout: 5000,
      });

      // Should set up interval for polling
      expect(jest.getTimerCount()).toBe(1);
    });

    it('should not crash or fire the callback when node execution is unavailable off-desktop', async () => {
      // SP binds executeNodeScript unconditionally; off-desktop it resolves to
      // { success: false } rather than being absent (the old "not available"
      // guard was dead code and has been removed). getFileMtime turns that into a
      // caught error, so the watcher starts its poll timer but never reports a
      // change. This asserts the realistic off-desktop contract.
      mockExecuteNodeScript.mockResolvedValue({ success: false, error: 'not desktop' });

      stopWatcher = startFileWatcher(mockFilePath, mockCallback);

      // The poll timer is still installed (no early-return guard).
      expect(jest.getTimerCount()).toBe(1);

      // Let the initial mtime check + a couple of polls run — nothing throws and
      // the callback is never invoked because no mtime is ever obtained.
      await jest.advanceTimersByTimeAsync(2000);
      await jest.advanceTimersByTimeAsync(2000);
      expect(mockCallback).not.toHaveBeenCalled();
    });

    it('should allow multiple watchers simultaneously', () => {
      const stop1 = startFileWatcher('/path/1.md', jest.fn());
      const stop2 = startFileWatcher('/path/2.md', jest.fn());

      expect(jest.getTimerCount()).toBe(2);

      stop1();
      expect(jest.getTimerCount()).toBe(1);
      stop2();
      expect(jest.getTimerCount()).toBe(0);
    });

    it('should trigger callback on file change event', async () => {
      const initialMtime = new Date('2024-01-01T00:00:00Z');
      const changedMtime = new Date('2024-01-01T00:00:01Z');

      // Mock initial check
      mockExecuteNodeScript.mockResolvedValueOnce({
        success: true,
        result: { success: true, mtime: initialMtime.toISOString() },
      });

      stopWatcher = startFileWatcher(mockFilePath, mockCallback);

      // Let initial mtime check complete
      await jest.advanceTimersToNextTimerAsync();

      // Now mock the changed mtime for the next poll
      mockExecuteNodeScript.mockResolvedValueOnce({
        success: true,
        result: { success: true, mtime: changedMtime.toISOString() },
      });

      // Advance timer to trigger poll
      await jest.advanceTimersByTimeAsync(2000);

      expect(mockCallback).toHaveBeenCalledTimes(1);
    });

    it('should not trigger callback when a missing file appears, by default', async () => {
      mockExecuteNodeScript.mockResolvedValueOnce({ success: true, result: { success: true, mtime: null } });
      stopWatcher = startFileWatcher(mockFilePath, mockCallback);
      await jest.advanceTimersToNextTimerAsync();

      mockExecuteNodeScript.mockResolvedValueOnce({
        success: true,
        result: { success: true, mtime: new Date('2024-01-01T00:00:00Z').toISOString() },
      });
      await jest.advanceTimersByTimeAsync(2000);

      expect(mockCallback).not.toHaveBeenCalled();
    });

    it('should trigger callback when a missing file appears with notifyOnCreate', async () => {
      mockExecuteNodeScript.mockResolvedValueOnce({ success: true, result: { success: true, mtime: null } });
      stopWatcher = startFileWatcher(mockFilePath, mockCallback, { notifyOnCreate: true });
      await jest.advanceTimersToNextTimerAsync();

      mockExecuteNodeScript.mockResolvedValueOnce({
        success: true,
        result: { success: true, mtime: new Date('2024-01-01T00:00:00Z').toISOString() },
      });
      await jest.advanceTimersByTimeAsync(2000);
      expect(mockCallback).toHaveBeenCalledTimes(1);

      // Later polls with the same mtime do not fire again.
      await jest.advanceTimersByTimeAsync(2000);
      expect(mockCallback).toHaveBeenCalledTimes(1);
    });

    it('should not trigger callback when mtime is unchanged', async () => {
      const sameMtime = new Date('2024-01-01T00:00:00Z');

      mockExecuteNodeScript.mockResolvedValue({
        success: true,
        result: { success: true, mtime: sameMtime.toISOString() },
      });

      stopWatcher = startFileWatcher(mockFilePath, mockCallback);

      // Let initial mtime check complete
      await Promise.resolve();

      // Advance timer to trigger multiple polls
      jest.advanceTimersByTime(1000);
      await Promise.resolve();
      jest.advanceTimersByTime(1000);
      await Promise.resolve();

      expect(mockCallback).not.toHaveBeenCalled();
    });
  });

  describe('stopWatcher function', () => {
    it('should stop the specific watcher', () => {
      stopWatcher = startFileWatcher(mockFilePath, mockCallback);
      expect(jest.getTimerCount()).toBe(1);

      stopWatcher();
      stopWatcher = null;

      expect(jest.getTimerCount()).toBe(0);
    });
  });
});
