/**
 * Decide whether a folder poll should trigger a projects sync. A sync is needed
 * only when the set of folder names changed since the last poll, so polling does
 * not restart the sync registry every tick. Pure.
 */
export const folderListChanged = (previous: string[] | null, current: string[]): boolean => {
  if (previous === null) return false; // first poll only records the baseline
  const a = [...previous].sort().join('\u0000');
  const b = [...current].sort().join('\u0000');
  return a !== b;
};
