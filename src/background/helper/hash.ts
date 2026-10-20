/**
 * Deterministic 53-bit content fingerprint (cyrb53). Pure, dependency-free —
 * the background bundle runs in SP's browser-like sandbox, so we cannot rely on
 * Node's `crypto`. Used to detect whether a Markdown file has been edited since
 * the last sync WITHOUT trusting the filesystem mtime: an editor that preserves
 * or lowers the mtime (atomic replace, restore-from-backup, same-second save)
 * fools an mtime comparison, but the content hash still differs
 * (super-productivity#9323 second review, point 4).
 *
 * Not cryptographic — collision probability is ~1 in 9e15 for our use, and a
 * collision would at worst pick the wrong initial sync direction in a rare
 * race; it is never a security boundary.
 */
export const hashContent = (str: string): string => {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
};
