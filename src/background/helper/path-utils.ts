/**
 * Lexically canonicalize a file path into a stable *comparison key*, the way
 * `path.resolve` would collapse it — but WITHOUT Node (the background bundle
 * runs in SP's browser-like sandbox and has no `path` module; the config iframe
 * uses an inline copy of this same logic).
 *
 * It resolves `.` / `..` segments, collapses duplicate and trailing separators
 * and unifies `\` / `/`, so that e.g. `/tmp/tasks.md` and `/tmp/./tasks.md` map
 * to the same key. This is what lets the sync registry refuse to start two
 * sessions on one physical file (two bindings on one file corrupt each other —
 * super-productivity#9323 second review, point 3).
 *
 * It is *lexical* only: it does not resolve symlinks (that needs `fs.realpath`,
 * done at save time in the config iframe where a Node call is available). The
 * returned string is meant for equality comparison, not for file I/O — always
 * open files with the user's original path (Node's `path.resolve` handles it).
 * Case is preserved: macOS is case-insensitive but Linux is not, so lower-casing
 * here would wrongly merge two distinct files on Linux.
 */
export const canonicalizePathKey = (input: string): string => {
  if (!input) return input;

  // A leading `X:` marks a Windows drive; normalize its letter (drives are
  // case-insensitive) and process the remainder as a rooted path.
  const winDrive = /^[a-zA-Z]:/.exec(input);
  const unified = input.replace(/\\/g, '/');
  const isAbsolute = unified.startsWith('/') || winDrive !== null;
  const root = winDrive ? winDrive[0].toUpperCase() + '/' : isAbsolute ? '/' : '';
  const rest = winDrive ? unified.slice(winDrive[0].length) : unified;

  const out: string[] = [];
  for (const seg of rest.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      // Pop the last real segment; at an absolute root `..` is a no-op, while a
      // relative path keeps leading `..`s (they cannot be resolved lexically).
      if (out.length > 0 && out[out.length - 1] !== '..') out.pop();
      else if (!isAbsolute) out.push('..');
      continue;
    }
    out.push(seg);
  }

  return root + out.join('/') || (isAbsolute ? root : '.');
};
