import * as fs from 'fs';
import * as path from 'path';

// Deleting an SP project must never delete a folder or file in the vault. Nothing in
// the plugin removes a folder; this test fails if a folder or file removal is added.
const SRC = path.join(__dirname, '..');
const FORBIDDEN = /\b(rmSync|rmdirSync|rmdir|unlinkSync|unlink|rm)\s*\(/;

const sourceFiles = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === '__tests__' ? [] : sourceFiles(p);
    return /\.ts$/.test(e.name) && !/\.spec\.ts$/.test(e.name) ? [p] : [];
  });

describe('no folder or file removal in the plugin', () => {
  it('has no remove or unlink call in the background code', () => {
    const hits = sourceFiles(SRC)
      .flatMap((f) =>
        fs
          .readFileSync(f, 'utf8')
          .split('\n')
          .map((line, i) => ({ f, i: i + 1, line }))
          .filter(({ line }) => FORBIDDEN.test(line) && !/^\s*(\/\/|\*)/.test(line)),
      )
      .map(({ f, i, line }) => `${path.relative(SRC, f)}:${i}: ${line.trim()}`);
    expect(hits).toEqual([]);
  });
});
