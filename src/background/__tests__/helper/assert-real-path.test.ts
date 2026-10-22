import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { assertRealPathInside } from '../../helper/file-utils';

// Run the node script the helper sends, against the real file system.
const runScript = async ({ script, args }: { script: string; args: unknown[] }) => ({
  success: true,
  result: new Function('require', 'args', script)(require, args),
});
(global as any).PluginAPI = { executeNodeScript: runScript };

describe('assertRealPathInside', () => {
  let base: string;
  let root: string;
  let outside: string;

  beforeEach(() => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-bridge-realpath-'));
    root = path.join(base, 'vault');
    outside = path.join(base, 'elsewhere');
    fs.mkdirSync(root);
    fs.mkdirSync(outside);
  });

  afterEach(() => {
    fs.rmSync(base, { recursive: true, force: true });
  });

  it('allows the root itself and a file that does not exist yet inside it', async () => {
    await expect(assertRealPathInside(root, root)).resolves.toBeUndefined();
    await expect(assertRealPathInside(root, path.join(root, 'Daily', '2026-10-22.md'))).resolves.toBeUndefined();
  });

  it('refuses a path that goes up out of the root', async () => {
    await expect(assertRealPathInside(root, path.join(root, '..', 'elsewhere', 'x.md'))).rejects.toThrow(
      'outside the vault',
    );
  });

  it('refuses a folder symlink inside the root that points outside', async () => {
    fs.symlinkSync(outside, path.join(root, 'Link'));
    await expect(assertRealPathInside(root, path.join(root, 'Link', 'x.md'))).rejects.toThrow('outside the vault');
  });

  it('refuses a dangling symlink inside the root', async () => {
    fs.symlinkSync(path.join(outside, 'missing.md'), path.join(root, 'dangling.md'));
    await expect(assertRealPathInside(root, path.join(root, 'dangling.md'))).rejects.toThrow();
  });

  it('allows a symlink inside the root that points to another place inside it', async () => {
    fs.mkdirSync(path.join(root, 'Real'));
    fs.symlinkSync(path.join(root, 'Real'), path.join(root, 'Alias'));
    await expect(assertRealPathInside(root, path.join(root, 'Alias', 'x.md'))).resolves.toBeUndefined();
  });
});
