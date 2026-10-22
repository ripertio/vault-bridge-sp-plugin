/**
 * The `#ignore` tag. A task whose title (SP) or line (Markdown) carries `#ignore` is left
 * out of the sync in both directions: it is not created, updated or deleted on either side.
 * Off by default (projects setting `respectIgnoreTag`); when off, nothing is ignored.
 */
const IGNORE_TAG_RE = /(^|\s)#ignore(?=\s|$)/i;
const ID_COMMENT_RE = /<!--\s*(.*?)\s*-->/;

let enabled = false;

/** Set from the projects setting. Called at each sync start, before any sync runs. */
export const setIgnoreTagEnabled = (on: boolean): void => {
  enabled = on;
};

/** True when a task title (SP) carries the ignore tag and the setting is on. */
export const isIgnoredTitle = (title: string): boolean => enabled && IGNORE_TAG_RE.test(title);

/** IDs of the Markdown task lines that carry the ignore tag (empty when the setting is off). */
export const ignoredIdsInMarkdown = (content: string): Set<string> => {
  const ids = new Set<string>();
  if (!enabled) return ids;
  for (const line of content.split('\n')) {
    if (!IGNORE_TAG_RE.test(line)) continue;
    const match = ID_COMMENT_RE.exec(line);
    if (match && match[1]) ids.add(match[1]);
  }
  return ids;
};

interface SyncNode {
  id: string | null;
  title: string;
  parentId?: string | null;
}

/**
 * Remove ignored tasks from both sides of a sync diff. A task is ignored when its own
 * title carries the tag, or when its ID is an ignored ID on either side (its SP task is
 * tagged, or its Markdown line is tagged). Children of an ignored task are ignored too, so
 * nothing is re-parented or recreated under a task that is left out. Pure apart from the
 * setting.
 */
export const withoutIgnored = <P extends SyncNode, T extends SyncNode>(
  parsed: P[],
  spTasks: T[],
): { parsed: P[]; spTasks: T[] } => {
  if (!enabled) return { parsed, spTasks };
  const ignored = new Set<string>();
  const everyTask: SyncNode[] = [...parsed, ...spTasks];
  // Fixed point: a child of an ignored task is ignored, and so on down the tree.
  let grew = true;
  while (grew) {
    grew = false;
    for (const t of everyTask) {
      if (!t.id || ignored.has(t.id)) continue;
      if (IGNORE_TAG_RE.test(t.title) || (t.parentId && ignored.has(t.parentId))) {
        ignored.add(t.id);
        grew = true;
      }
    }
  }
  const dropped = (t: SyncNode): boolean =>
    IGNORE_TAG_RE.test(t.title) || (!!t.id && ignored.has(t.id)) || (!!t.parentId && ignored.has(t.parentId));
  return { parsed: parsed.filter((t) => !dropped(t)), spTasks: spTasks.filter((t) => !dropped(t)) };
};
