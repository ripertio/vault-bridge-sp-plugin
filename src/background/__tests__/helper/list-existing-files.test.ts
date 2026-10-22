import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { listExistingFiles } from '../../helper/file-utils';

// Run the node script the helper sends, against the real file system.
const runScript = async ({ script, args }: { script: string; args: unknown[] }) => ({
  success: true,
  result: new Function('require', 'args', script)(require, args),
});
(global as any).PluginAPI = { executeNodeScript: runScript };

describe('listExistingFiles', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-md-files-'));
    fs.mkdirSync(path.join(dir, 'Inbox'));
    fs.writeFileSync(path.join(dir, 'Inbox', 'backlog.md'), '- [ ] a\n');
    fs.mkdirSync(path.join(dir, 'Folder'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('returns only the paths that exist as files', async () => {
    expect(await listExistingFiles(dir, ['Inbox/backlog.md', 'Inbox/missing.md', 'Folder'])).toEqual([
      'Inbox/backlog.md',
    ]);
  });

  it('returns nothing for an empty list', async () => {
    expect(await listExistingFiles(dir, [])).toEqual([]);
  });
});
