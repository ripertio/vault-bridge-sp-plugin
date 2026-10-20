/**
 * Regression test for the "automatic SP→MD path clobbers a fresh Markdown edit"
 * blocker (@johannesjo, THIRD review of super-productivity#9323).
 *
 * v0.3.1 added the content-fingerprint direction check (fileHasUnsyncedEdit) to
 * syncAllNow ONLY. An ordinary SP edit reaches handleSpChange via the
 * taskUpdate/anyTaskUpdate hooks and used to run spToMd unconditionally after the
 * debounce — so an SP change occurring while a manual `.md` edit was detected but
 * not yet imported would overwrite that edit.
 *
 * v0.4.0 applies the same fingerprint guard in handleSpChange: if the file has an
 * unsynced edit, import MD→SP FIRST (edit wins), then write SP→MD back. If the
 * file is unchanged since the last sync, write SP→MD only (no needless import).
 */
import {
  initSyncRegistry,
  _resetForTesting,
} from '../../sync/sync-manager';
import { SyncBindingCfg } from '../../local-config';

jest.mock('../../sync/file-watcher');
jest.mock('../../sync/sp-to-md');
jest.mock('../../sync/md-to-sp');
jest.mock('../../helper/file-utils');
jest.mock('../../sync/verify-sync');
jest.mock('../../../shared/logger', () => ({
  log: {
    critical: jest.fn(),
    err: jest.fn(),
    error: jest.fn(),
    log: jest.fn(),
    normal: jest.fn(),
    info: jest.fn(),
    verbose: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
  },
}));

import { startFileWatcher } from '../../sync/file-watcher';
import { spToMd } from '../../sync/sp-to-md';
import { mdToSp } from '../../sync/md-to-sp';
import { getFileStats, readTasksFile } from '../../helper/file-utils';
import { verifySyncState } from '../../sync/verify-sync';

const CONTENT_AT_LAST_SYNC = '- [x] <!--t1--> Edited @done';
const CONTENT_AFTER_EDIT = '- [x] <!--t1--> Edited @done\n- [ ] a fresh manual line';
const STABLE_MTIME = new Date(1000);

// Capture the hook callbacks the registry installs so the test can fire a
// taskUpdate exactly like SP would.
const hooks: Record<string, (...a: unknown[]) => void> = {};

(global as any).PluginAPI = {
  log: { debug: jest.fn(), error: jest.fn(), log: jest.fn() },
  persistDataSynced: jest.fn(),
  loadSyncedData: jest.fn(),
  showSnack: jest.fn(),
  registerHook: jest.fn((name: string, cb: (...a: unknown[]) => void) => {
    hooks[name] = cb;
  }),
  onWindowFocusChange: jest.fn(),
  getAllProjects: jest.fn().mockResolvedValue([{ id: 'test-project', title: 'Test' }]),
};

const binding: SyncBindingCfg = {
  id: 'b1',
  filePath: '/test/tasks.md',
  projectId: 'test-project',
  enabled: true,
};

// Wait past the SYNC_DEBOUNCE_MS (500 ms) debounce, then let microtasks settle.
const waitForDebounce = async (): Promise<void> => {
  await new Promise((r) => setTimeout(r, 700));
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
};

const flush = async (): Promise<void> => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
};

describe('handleSpChange — does not clobber a fresh Markdown edit (SP→MD path)', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    _resetForTesting();
    for (const k of Object.keys(hooks)) delete hooks[k];

    (startFileWatcher as jest.Mock).mockReturnValue(() => {});
    (spToMd as jest.Mock).mockResolvedValue(undefined);
    (mdToSp as jest.Mock).mockResolvedValue('ok');
    (verifySyncState as jest.Mock).mockResolvedValue({ isInSync: true });
    (getFileStats as jest.Mock).mockResolvedValue({ mtime: STABLE_MTIME });
    // Initial sync records the baseline fingerprint from this content.
    (readTasksFile as jest.Mock).mockResolvedValue(CONTENT_AT_LAST_SYNC);

    initSyncRegistry([binding], {});
    await flush();

    // Only observe the SP change that follows.
    (spToMd as jest.Mock).mockClear();
    (mdToSp as jest.Mock).mockClear();
  });

  it('imports the pending MD edit BEFORE writing SP→MD when the file changed', async () => {
    // A manual edit is present in the file but not yet imported.
    (readTasksFile as jest.Mock).mockResolvedValue(CONTENT_AFTER_EDIT);

    // SP fires a taskUpdate for this binding's project.
    expect(typeof hooks['taskUpdate']).toBe('function');
    hooks['taskUpdate']({ task: { projectId: 'test-project' }, changes: { title: 'x' } });
    await waitForDebounce();

    expect(mdToSp).toHaveBeenCalled();
    expect(spToMd).toHaveBeenCalled();
    const importOrder = (mdToSp as jest.Mock).mock.invocationCallOrder[0];
    const writeOrder = (spToMd as jest.Mock).mock.invocationCallOrder[0];
    expect(importOrder).toBeLessThan(writeOrder); // edit imported before overwrite
  });

  it('does NOT write SP→MD when the pending MD edit is malformed (parse-error)', async () => {
    (readTasksFile as jest.Mock).mockResolvedValue(CONTENT_AFTER_EDIT);
    (mdToSp as jest.Mock).mockResolvedValue('parse-error');

    hooks['taskUpdate']({ task: { projectId: 'test-project' }, changes: { title: 'x' } });
    await waitForDebounce();

    expect(mdToSp).toHaveBeenCalled();
    expect(spToMd).not.toHaveBeenCalled(); // malformed file left untouched
  });

  it('writes SP→MD only (no needless import) when the file is unchanged', async () => {
    // File content matches the recorded baseline → no pending edit.
    (readTasksFile as jest.Mock).mockResolvedValue(CONTENT_AT_LAST_SYNC);

    hooks['taskUpdate']({ task: { projectId: 'test-project' }, changes: { title: 'x' } });
    await waitForDebounce();

    expect(spToMd).toHaveBeenCalled();
    expect(mdToSp).not.toHaveBeenCalled();
  });
});
