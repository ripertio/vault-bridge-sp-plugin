import { startFileWatcher } from './file-watcher';
import { spToMd } from './sp-to-md';
import { mdToSp } from './md-to-sp';
import { getFileStats, readTasksFile, writeTasksFile } from '../helper/file-utils';
import { canonicalizePathKey } from '../helper/path-utils';
import { hashContent } from '../helper/hash';
import {
  PROJECT_DELETE_SETTLE_MS,
  PROJECT_MISSING_RECHECK_MS,
  SP_HOOK_COOLDOWN_MS,
  SYNC_DEBOUNCE_MS,
  SYNC_DEBOUNCE_MS_MD_TO_SP,
} from '../config.const';
// PluginHooks is imported as TYPE only — erased at build time, no runtime require().
// The actual string values are defined in SP_HOOKS below.
import type { PluginHooks } from '@super-productivity/plugin-api';
// SP internal hook names used at runtime.
// Must match the strings declared in manifest.json "hooks" array.
// SP dispatches hooks in camelCase (consistent with the published PluginHooks enum).
const SP_HOOKS = {
  ANY_TASK_UPDATE: 'anyTaskUpdate' as unknown as PluginHooks,
  PROJECT_LIST_UPDATE: 'projectListUpdate' as unknown as PluginHooks,
  // Generic NgRx-action hook. Safety net for STRUCTURAL task actions that
  // taskUpdate/anyTaskUpdate do NOT surface — notably `[Task] Add SubTask`
  // (confirmed via console log on SP 18.16: adding a subtask fires only this).
  ACTION: 'action' as unknown as PluginHooks,
} as const;
import { SyncBindingCfg } from '../local-config';
import { logSyncVerification, verifySyncState } from './verify-sync';
import {
  showMissingFileDialog,
  showMissingProjectDialog,
  createSpProject,
} from './missing-resource';
import { log } from '../../shared/logger';

export interface SyncSession {
  config: SyncBindingCfg;
  stopWatcher: (() => void) | null;
  syncInProgress: boolean;
  mdToSpDebounceTimer: ReturnType<typeof setTimeout> | null;
  spToMdDebounceTimer: ReturnType<typeof setTimeout> | null;
  lastMdToSpSyncTimestamp: number;
  pendingMdToSpSync: boolean;
  // Content fingerprint of the file captured at the end of the last successful
  // sync. syncAllNow compares the file's CURRENT hash against this to decide
  // whether the file has an unsynced edit (import it first, so a manual edit is
  // never clobbered). Content-based, not mtime-based: an editor that preserves
  // or lowers the mtime would fool a timestamp comparison (point 4). Null until
  // the first sync records it, or when the file could not be read.
  lastSyncedContentHash: string | null;
  // True once this binding has synced successfully at least once (seeded from the
  // persisted _lastSynced map). Distinguishes a brand-new binding — create the
  // file silently — from one whose file was deleted (prompt the user).
  hasSyncedBefore: boolean;
}

/**
 * Bridge to the config owner (background.ts). The sync layer never touches the
 * persisted config directly; it reports through these callbacks so background
 * stays the single source of truth for reads/writes/registry restarts.
 */
export interface ConfigBridge {
  /** Record a successful sync time for a binding (ISO string). */
  reportSynced: (bindingId: string, isoTime: string) => void;
  /** Remove a binding from the config (and restart the registry). */
  deleteBinding: (bindingId: string) => void;
  /** Point a binding at a different SP project (after recreating it). */
  repointBinding: (bindingId: string, newProjectId: string) => void;
  /** Persist the last-known SP project title for a binding. */
  updateBindingTitle: (bindingId: string, title: string) => void;
}

let configBridge: ConfigBridge | null = null;
export const setConfigBridge = (bridge: ConfigBridge): void => {
  configBridge = bridge;
};

const sessions = new Map<string, SyncSession>();

// Binding ids that currently have a missing-resource dialog open. Keyed by
// binding id (NOT session object) so the guard survives registry restarts: if a
// rebuild leaves an orphaned session whose async op is still in flight, it can't
// stack a second dialog for the same binding.
const openDialogBindings = new Set<string>();

// Binding ids whose project is being recreated right now. `divertIfProjectMissing`
// bails while this is set, so the `projectListUpdate` that `addProject` fires
// during a recreate can't re-trigger the dialog — the feedback loop that spawned
// duplicate projects. NOT bounded by the openDialog promise (SP resolves it early,
// before onRecreate finishes), so it's owned by the recreate op itself.
const recreatingBindings = new Set<string>();

// Per-binding cooldown: timestamp of the last dialog close. A fresh dialog for
// the same binding is suppressed within PROMPT_COOLDOWN_MS. Backstop against
// re-prompt storms when SP's openDialog resolves before the user acts.
const lastPromptAt = new Map<string, number>();
const PROMPT_COOLDOWN_MS = 5_000;

let isWindowFocused = document.hasFocus();

/** Poll until the given project id shows up in getAllProjects (or give up). */
const waitForProjectVisible = async (projectId: string): Promise<void> => {
  for (let i = 0; i < 15; i++) {
    try {
      const projects = await PluginAPI.getAllProjects();
      if (projects.some((p) => p.id === projectId)) return;
    } catch {
      return;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 200));
  }
};

/** True if a dialog for this binding is open or within its post-close cooldown. */
const isDialogSuppressed = (bindingId: string): boolean =>
  openDialogBindings.has(bindingId) ||
  Date.now() - (lastPromptAt.get(bindingId) ?? -Infinity) < PROMPT_COOLDOWN_MS;

let hooksRegistered = false;
let focusTrackingActive = false;

/**
 * Decide whether the Markdown file has an edit not yet reflected in the last
 * sync, by comparing content fingerprints. Deliberately takes only hashes (no
 * mtime): a null baseline (never synced, or the file was unreadable at the last
 * sync) is treated as "changed" so Sync Now imports first and never clobbers a
 * possible edit. Pure + exported so the direction rule is unit-testable without
 * the sync machinery (#9323 review, point 4).
 */
export const fileHasUnsyncedEdit = (
  currentContentHash: string | null,
  lastSyncedContentHash: string | null,
): boolean =>
  lastSyncedContentHash === null || currentContentHash !== lastSyncedContentHash;

/** Mark a session as having synced now, and report it to the config owner. */
const markSynced = async (session: SyncSession): Promise<void> => {
  session.hasSyncedBefore = true;
  configBridge?.reportSynced(session.config.id, new Date().toISOString());
  // Record a fingerprint of the file's current content as the "last synced"
  // baseline. A later Markdown edit changes the content hash regardless of what
  // it does to the mtime, so syncAllNow imports it before writing SP→MD and
  // cannot clobber the edit (point 4).
  try {
    const content = await readTasksFile(session.config.filePath);
    session.lastSyncedContentHash = content === null ? null : hashContent(content);
  } catch {
    session.lastSyncedContentHash = null;
  }
};

/**
 * Reduce the configured bindings to those eligible to sync (enabled, with a
 * file and a project), dropping any whose file canonically resolves to the same
 * location as an earlier one. Returns the survivors in order plus the dropped
 * duplicates (each with the id of the binding that already claimed that file)
 * so the caller can warn the user. Pure + exported so the dedup rule can be
 * unit-tested without spinning up the sync machinery (#9323 review, point 3).
 */
export const dedupeBindingsByCanonicalPath = (
  bindings: SyncBindingCfg[],
): {
  unique: SyncBindingCfg[];
  duplicates: { binding: SyncBindingCfg; owner: string }[];
} => {
  const unique: SyncBindingCfg[] = [];
  const duplicates: { binding: SyncBindingCfg; owner: string }[] = [];
  const claimed = new Map<string, string>(); // canonical key -> owning binding id
  for (const binding of bindings) {
    if (!(binding.enabled && binding.filePath && binding.projectId)) continue;
    const key = canonicalizePathKey(binding.filePath);
    const owner = claimed.get(key);
    if (owner) {
      duplicates.push({ binding, owner });
      continue;
    }
    claimed.set(key, binding.id);
    unique.push(binding);
  }
  return { unique, duplicates };
};

export const initSyncRegistry = (
  bindings: SyncBindingCfg[],
  lastSynced: Record<string, string> = {},
): void => {
  // Dispose existing sessions
  disposeAllSessions();

  // Setup window focus tracking once
  setupWindowFocusTracking();

  // Create the sessions synchronously, then run their initial syncs
  // SEQUENTIALLY (Bug #31): on SP 18.13.1's faster startup, firing every
  // binding's performInitialSync in parallel made the last binding fail
  // ("Initial sync failed…") because SP can't process several at once. Running
  // them one after another (await per binding) removes the race.
  // Backstop against two bindings pointing at the SAME physical file (#9323
  // second review, point 3). Two sessions on one file each write it and then
  // re-import the other's write → mutual corruption. The config UI blocks this
  // on entry, but a legacy/hand-edited config can still carry duplicates (e.g.
  // `/tmp/tasks.md` and `/tmp/./tasks.md`), so refuse to start a second session
  // on any file already claimed. Comparison is by lexical canonical key; the
  // session still does I/O with the binding's original path.
  const { unique, duplicates } = dedupeBindingsByCanonicalPath(bindings);
  duplicates.forEach(({ binding, owner }) => {
    log.error(
      `[vault-bridge] Binding ${binding.id} points at the same file as binding ${owner} ` +
        `("${binding.filePath}"). Skipping it — two bindings on one file corrupt each other.`,
    );
    PluginAPI.showSnack({
      msg: `Vault Bridge: two bindings point at the same file ("${binding.filePath}"). Only one is active — remove the duplicate in the config panel.`,
      type: 'ERROR',
    });
  });
  const pendingInitialSync: SyncSession[] = unique.map((binding) =>
    createSyncSession(binding, !!lastSynced[binding.id]),
  );

  // Register global hooks only once — registering them from inside a hook
  // callback (e.g. persistedDataChanged) can silently fail in some SP versions,
  // and duplicate registrations would fire every handler twice.
  if (!hooksRegistered) {
    setupGlobalHooks();
    hooksRegistered = true;
  }

  // Kick off the sequential initial-sync runner (fire-and-forget so the
  // registry setup itself stays synchronous for callers; the syncs inside run
  // strictly one at a time).
  void runInitialSyncsSequentially(pendingInitialSync);
};

/** Create a SyncSession and register it, without starting its initial sync. */
const createSyncSession = (
  config: SyncBindingCfg,
  hasSyncedBefore: boolean,
): SyncSession => {
  const session: SyncSession = {
    config,
    stopWatcher: null,
    syncInProgress: false,
    mdToSpDebounceTimer: null,
    spToMdDebounceTimer: null,
    lastMdToSpSyncTimestamp: -SP_HOOK_COOLDOWN_MS,
    pendingMdToSpSync: false,
    hasSyncedBefore,
    lastSyncedContentHash: null,
  };

  sessions.set(config.id, session);
  return session;
};

/**
 * Run each session's initial sync one at a time. `performInitialSync` stops and
 * restarts the watcher internally (in its finally block), so we must NOT start a
 * watcher here. Errors are logged per-session and do not stop the others.
 */
const runInitialSyncsSequentially = async (
  sessionsToSync: SyncSession[],
): Promise<void> => {
  for (const session of sessionsToSync) {
    try {
      await performInitialSync(session);
    } catch (err) {
      log.error(
        `[vault-bridge] Unhandled error in performInitialSync for ${session.config.id}:`,
        err,
      );
    }
  }
};

/** Stop a session's watcher + timers and remove it from the registry. */
const disposeSession = (session: SyncSession): void => {
  if (session.stopWatcher) session.stopWatcher();
  if (session.mdToSpDebounceTimer) clearTimeout(session.mdToSpDebounceTimer);
  if (session.spToMdDebounceTimer) clearTimeout(session.spToMdDebounceTimer);
  sessions.delete(session.config.id);
};

const disposeAllSessions = (): void => {
  sessions.forEach((session) => disposeSession(session));
  sessions.clear();
};

/**
 * True if `session` is still the live session for its binding id. After a
 * "Delete binding" (or a registry restart) the object is orphaned; guarding the
 * watcher-restart in `finally` blocks with this prevents a deleted binding from
 * leaving a polling watcher behind.
 */
const isCurrent = (session: SyncSession): boolean =>
  sessions.get(session.config.id) === session;

/**
 * Missing `.md` file at sync time (case 3a). The binding cannot continue broken,
 * so the user must choose: recreate from SP / delete binding / ignore. Awaited
 * by callers so startup dialogs appear one at a time (never stacked). The caller
 * must already hold the sync (watcher stopped, syncInProgress) so the recreate
 * path can write safely.
 */
const handleMissingFile = async (session: SyncSession): Promise<void> => {
  // Anti-stacking: never from an orphaned session, and one dialog per binding id
  // with a post-close cooldown (SP resolves openDialog early, so we can't rely on
  // its promise to bound the guard).
  if (!isCurrent(session) || isDialogSuppressed(session.config.id)) return;
  openDialogBindings.add(session.config.id);
  try {
    await showMissingFileDialog(session.config.filePath, {
      onRecreate: async () => {
        await spToMd(session.config);
        await markSynced(session);
        PluginAPI.showSnack({
          msg: `Vault Bridge: "${session.config.filePath}" recreated from SP.`,
          type: 'SUCCESS',
        });
      },
      onDelete: () => {
        disposeSession(session);
        configBridge?.deleteBinding(session.config.id);
        PluginAPI.showSnack({
          msg: 'Vault Bridge: binding deleted (file was missing).',
          type: 'INFO',
        });
      },
      onIgnore: () => {
        // Nothing to do — the next sync trigger re-checks and, if the file is
        // still missing, this dialog reopens after the cooldown (no flicker).
      },
    });
  } finally {
    openDialogBindings.delete(session.config.id);
    lastPromptAt.set(session.config.id, Date.now());
  }
};

/**
 * For a binding that has synced before, divert to the missing-file dialog if its
 * `.md` file is gone. Returns true if diverted (the caller must abort its sync).
 * A brand-new binding never diverts here — `performInitialSync` creates its file.
 */
const divertIfFileMissing = async (session: SyncSession): Promise<boolean> => {
  if (!session.hasSyncedBefore) return false;
  const fileStats = await getFileStats(session.config.filePath);
  if (fileStats) return false;
  await handleMissingFile(session);
  return true;
};

/** Derive a project title from the file name (basename without .md extension). */
const deriveProjectTitle = (filePath: string): string => {
  const base = filePath.split(/[/\\]/).pop() ?? filePath;
  return base.replace(/\.md$/i, '') || base;
};

/**
 * Strip the `<!--taskId-->` markers from checkbox lines. Used when reimporting a
 * `.md` into a freshly recreated project: the stored ids belong to the deleted
 * project's tasks, so keeping them would make the import generate update ops for
 * tasks that no longer exist (batch failure). Stripped → every task is created
 * anew, and the following spToMd stamps the new ids back into the file.
 */
const stripTaskIds = (content: string): string =>
  content.replace(/^(\s*- \[[ x]\]\s*)<!--[^>]*-->\s*/gm, '$1');

/**
 * "Delete + clean file" support: strip the `<!--taskId-->` markers from a `.md`
 * so it is left neutral after its binding is deleted. Mirrors the config-panel's
 * `sanitizeMdFile` (iframe) — both use `stripTaskIds`'s regex; kept in sync by
 * hand because the iframe (sandboxed HTML) can't import this module.
 * Returns 'not-found' if the file is gone, 'cleaned' if it changed, or
 * 'already-clean' if there was nothing to strip. Never throws for a missing
 * file; genuine I/O errors propagate to the caller.
 */
const cleanFileMarkers = async (
  filePath: string,
): Promise<'not-found' | 'cleaned' | 'already-clean'> => {
  const content = await readTasksFile(filePath);
  if (content === null) return 'not-found';
  const cleaned = stripTaskIds(content);
  if (cleaned === content) return 'already-clean';
  await writeTasksFile(filePath, cleaned);
  return 'cleaned';
};

/**
 * Deleted SP project at sync time (case 3b). The `.md` is intact and untouched;
 * the user chooses recreate-in-SP or delete-binding (no "ignore" — a deleted
 * project has no valid external fix). Awaited so startup dialogs stay sequential;
 * the caller must already hold the sync (watcher stopped, syncInProgress).
 */
const handleMissingProject = async (
  session: SyncSession,
  proactive = false,
): Promise<void> => {
  const id = session.config.id;
  // Anti-stacking: never from an orphaned session, and one dialog per binding id
  // with a post-close cooldown (SP resolves openDialog early, so we can't rely on
  // its promise to bound the guard).
  if (!isCurrent(session) || isDialogSuppressed(id)) return;
  openDialogBindings.add(id);
  try {
    // Bug #48. A PROACTIVE detection — one not driven by a user interaction, i.e. a
    // project deletion routed here from the `action` hook (see
    // PROJECT_DELETE_ACTION_NAMES) or from `projectListUpdate` — hits two problems
    // the manual Sync Now path never does:
    //   • A modal opened inside the post-delete churn is dismissed by SP's own
    //     navigation away from the deleted project (console: `PluginBridge: Dialog
    //     closed`, no user click), so the user never sees it.
    //   • Whichever automatic path reaches here first burns the per-binding guard,
    //     so a later, better-timed attempt is suppressed.
    // Fix, centralised at this chokepoint so it applies no matter which path detects
    // the deletion: (1) fire a snack immediately — snacks paint from the background
    // and are not dismissed by navigation (same path as the update notifier), so the
    // deletion is always surfaced at once; then (2) hold the guard and wait out the
    // churn (PROJECT_DELETE_SETTLE_MS) before opening the modal, so it lands in a
    // settled UI and stays open. Verified in vivo: snack ~7 ms after the delete,
    // dialog ~2.0 s after it, no auto-close.
    if (proactive) {
      // Kept short on purpose: the snack is only a heads-up for the ~2 s in which
      // the modal cannot yet be shown, and the modal that follows carries the
      // options. Name the PROJECT, not the file path — `projectTitle` is refreshed
      // on every existence check (see checkProjectExists), so it is the last name
      // the user actually saw, and an absolute path made the message unreadable.
      const title = session.config.projectTitle || deriveProjectTitle(session.config.filePath);
      // INFO, not ERROR: the deletion is something the user just did on purpose,
      // and the modal that follows is where the actual decision is made — a red
      // error snack overstated it.
      PluginAPI.showSnack({
        msg: `Vault Bridge: project "${title}" was deleted — opening options…`,
        type: 'INFO',
      });
      await new Promise((resolve) => setTimeout(resolve, PROJECT_DELETE_SETTLE_MS));
      if (!isCurrent(session)) return;
    }
    // Recreating the project needs the `.md` as its source. If the file is also
    // gone, only "delete binding" is offered.
    const fileStats = await getFileStats(session.config.filePath);
    const canRecreate = !!fileStats;

    await showMissingProjectDialog(
      session.config.filePath,
      {
        onRecreate: async () => {
          // Take the recreate lock FIRST (synchronously), before addProject fires
          // projectListUpdate — otherwise that event re-enters the dialog and we
          // spawn duplicate projects. divertIfProjectMissing bails while it's set.
          if (recreatingBindings.has(id)) return;
          recreatingBindings.add(id);
          try {
            const content = await readTasksFile(session.config.filePath);
            // Prefer the last-known project title; fall back to the file name.
            const title = session.config.projectTitle || deriveProjectTitle(session.config.filePath);
            const newProjectId = await createSpProject(title);
            // Re-point this session and the persisted binding to the new project.
            session.config = { ...session.config, projectId: newProjectId };
            configBridge?.repointBinding(id, newProjectId);
            // Wait until SP actually lists the new project before importing, or
            // mdToSp/spToMd would fail with "Project not found".
            await waitForProjectVisible(newProjectId);
            // Strip the stale task ids (they belong to the deleted project) so the
            // import creates fresh tasks instead of failing on non-existent ids.
            // If the .md is malformed, mdToSp returns 'parse-error' having done
            // nothing — do NOT write SP→MD back over the file or markSynced then
            // (same guard as every other caller; #9323 third review, point-2 gap).
            if (content) {
              const result = await mdToSp(stripTaskIds(content), newProjectId);
              if (result === 'parse-error') {
                PluginAPI.showSnack({
                  msg: `Vault Bridge: project "${title}" recreated, but "${session.config.filePath}" could not be parsed — fix the file and Sync Now.`,
                  type: 'ERROR',
                });
                return;
              }
            }
            await spToMd(session.config);
            markSynced(session);
            PluginAPI.showSnack({
              msg: `Vault Bridge: project "${title}" recreated in SP for "${session.config.filePath}".`,
              type: 'SUCCESS',
            });
          } catch (err) {
            log.error(`[vault-bridge] Recreate project failed for ${id}:`, err);
            PluginAPI.showSnack({
              msg: `Vault Bridge: could not recreate the project for "${session.config.filePath}".`,
              type: 'ERROR',
            });
          } finally {
            lastPromptAt.set(id, Date.now());
            recreatingBindings.delete(id);
          }
        },
        onDelete: () => {
          disposeSession(session);
          configBridge?.deleteBinding(id);
          PluginAPI.showSnack({
            msg: 'Vault Bridge: binding deleted (project was missing).',
            type: 'INFO',
          });
        },
        // Only offered when the `.md` still exists (canRecreate). Clean the file
        // FIRST (while we still have the path), then delete the binding — same
        // order and behaviour as the config-panel "Delete + clean file".
        onDeleteAndClean: async () => {
          let cleanNote = '';
          try {
            const outcome = await cleanFileMarkers(session.config.filePath);
            cleanNote =
              outcome === 'not-found'
                ? ' (file not found)'
                : outcome === 'cleaned'
                  ? ' + file cleaned'
                  : ' (file already clean)';
          } catch (err) {
            log.error(`[vault-bridge] Clean file failed for ${id}:`, err);
            cleanNote = " (couldn't clean file)";
          }
          disposeSession(session);
          configBridge?.deleteBinding(id);
          PluginAPI.showSnack({
            msg: `Vault Bridge: binding deleted (project was missing)${cleanNote}.`,
            type: 'INFO',
          });
        },
        onIgnore: () => {
          // Nothing to do — the post-close cooldown (set in the finally) delays
          // the re-check; the next sync trigger re-opens this dialog if the
          // project is still missing. Meant for "I'll create a project and
          // re-point the binding myself".
        },
      },
      canRecreate,
      session.config.projectTitle,
    );
  } finally {
    openDialogBindings.delete(id);
    lastPromptAt.set(id, Date.now());
  }
};

/**
 * Divert to the missing-project dialog if the bound SP project no longer exists.
 * Returns true if diverted (caller must abort its sync). Fail-open: if the
 * project list can't be read, assume present and let the sync proceed. Checked
 * BEFORE the file check so a project-deletion (which would otherwise make spToMd
 * write an empty file and wipe the `.md`) is caught first.
 */
const divertIfProjectMissing = async (
  session: SyncSession,
  proactive = false,
): Promise<boolean> => {
  try {
    // Recreate in flight for this binding — abort the sync and do not re-check,
    // so addProject's projectListUpdate can't re-open the dialog (feedback loop).
    if (recreatingBindings.has(session.config.id)) return true;
    if (typeof PluginAPI.getAllProjects !== 'function') return false;
    const projects = await PluginAPI.getAllProjects();
    const project = projects.find((p) => p.id === session.config.projectId);
    if (project) {
      // Project exists — capture its current title so it can be shown in the
      // "project deleted" dialog and reused to recreate it under its real name.
      if (project.title && session.config.projectTitle !== project.title) {
        session.config = { ...session.config, projectTitle: project.title };
        configBridge?.updateBindingTitle(session.config.id, project.title);
      }
      return false;
    }
    await handleMissingProject(session, proactive);
    return true;
  } catch (err) {
    log.error('[vault-bridge] project existence check failed:', err);
    return false;
  }
};

const performInitialSync = async (session: SyncSession): Promise<void> => {
  if (session.syncInProgress) return;
  session.syncInProgress = true;

  // Stop watcher during initial sync to avoid feedback loops.
  if (session.stopWatcher) session.stopWatcher();

  try {
    // Project gone? Prompt (recreate / delete) before touching the file — a
    // missing project would otherwise make spToMd write an empty file and wipe
    // the Markdown. Awaited so startup dialogs are sequential.
    if (await divertIfProjectMissing(session)) return;
    const fileStats = await getFileStats(session.config.filePath);
    if (!fileStats) {
      if (session.hasSyncedBefore) {
        // The file existed before and is now gone — a real deletion, not a new
        // binding. Prompt the user (recreate / delete binding / ignore) instead
        // of silently recreating it. Awaited so startup dialogs are sequential.
        await handleMissingFile(session);
      } else {
        // Brand-new binding — write SP tasks to it (creates file with task IDs).
        // No prompt: creating the file is the expected first-time behaviour.
        await spToMd(session.config);
        await markSynced(session);
      }
    } else {
      const content = await readTasksFile(session.config.filePath);
      // A file is considered to "have tasks" only if it contains at least one
      // checkbox line. A file that is empty or contains only whitespace/headers
      // is treated the same as a non-existent file: SP is the source of truth
      // and its tasks are written to the file. This prevents the dangerous case
      // where an empty (or whitespace-only) file causes all SP tasks to be deleted.
      const hasTasks = content ? /^[ \t]*- \[[ x]\]/m.test(content) : false;
      if (hasTasks) {
        // File has tasks — file is the source of truth. Import into SP, then
        // always write back so task IDs are stamped into the Markdown file.
        const result = await mdToSp(content!, session.config.projectId);
        if (result === 'parse-error') {
          // Malformed file at startup — leave it exactly as-is (no write-back
          // that would clobber it, no markSynced) and let the watcher retry on
          // the next edit. mdToSp already warned via snack.
          return;
        }
        await spToMd(session.config);
        const verificationResult = await verifySyncState(session.config);
        logSyncVerification(verificationResult, `initial sync [${session.config.id}]`);
      } else {
        // File exists but has no task lines — write SP tasks to it.
        await spToMd(session.config);
      }
      await markSynced(session);
    }
  } catch (error) {
    log.error(`[vault-bridge] Initial sync failed for ${session.config.id}:`, error);
    PluginAPI.showSnack({
      msg: `Vault Bridge: Initial sync failed for "${session.config.filePath}". Plugin is still active.`,
      type: 'ERROR',
    });
  } finally {
    session.syncInProgress = false;
    // Restart watcher after initial sync completes — unless the session was
    // removed in the meantime (e.g. the user chose "Delete binding").
    if (isCurrent(session)) {
      session.stopWatcher = startFileWatcher(session.config.filePath, () => {
        handleFileChange(session);
      });
    }
  }
};

const handleFileChange = (session: SyncSession): void => {
  if (session.mdToSpDebounceTimer) clearTimeout(session.mdToSpDebounceTimer);

  if (isWindowFocused) {
    executeMdToSpSync(session);
    return;
  }

  session.pendingMdToSpSync = true;
  session.mdToSpDebounceTimer = setTimeout(() => {
    executeMdToSpSync(session);
  }, SYNC_DEBOUNCE_MS_MD_TO_SP);
};

const executeMdToSpSync = async (session: SyncSession): Promise<void> => {
  if (session.syncInProgress) return;
  session.syncInProgress = true;
  session.pendingMdToSpSync = false;
  session.mdToSpDebounceTimer = null;

  if (session.spToMdDebounceTimer) {
    clearTimeout(session.spToMdDebounceTimer);
    session.spToMdDebounceTimer = null;
  }

  // Stop watcher during sync
  if (session.stopWatcher) session.stopWatcher();
  session.lastMdToSpSyncTimestamp = Date.now();

  try {
    if (await divertIfProjectMissing(session)) return;
    const content = await readTasksFile(session.config.filePath);
    if (content === null && session.hasSyncedBefore) {
      // readTasksFile returns null on ENOENT — the file was deleted. Prompt.
      await handleMissingFile(session);
    } else if (content) {
      const result = await mdToSp(content, session.config.projectId);
      if (result === 'parse-error') {
        // The file is malformed. mdToSp left SP untouched; we must ALSO leave
        // the file untouched — a SP→MD write-back here would overwrite the
        // user's in-progress edit with stale SP state (they'd see their change
        // reverted). Do not mark synced, so the next valid edit is still
        // detected. The watcher (restarted in `finally`) retries on that edit.
        return;
      }

      const verificationResult = await verifySyncState(session.config);
      if (!verificationResult.isInSync) {
        await spToMd(session.config);
      }
      await markSynced(session);
    }
  } catch (error) {
    log.error(`[vault-bridge] MD to SP sync failed for ${session.config.id}:`, error);
    PluginAPI.showSnack({
      msg: `Vault Bridge: Sync failed for "${session.config.filePath}". Check markdown for formatting issues.`,
      type: 'WARNING',
    });
  } finally {
    session.lastMdToSpSyncTimestamp = Date.now();
    if (isCurrent(session)) {
      session.stopWatcher = startFileWatcher(session.config.filePath, () => {
        handleFileChange(session);
      });
    }
    session.syncInProgress = false;
  }
};

const setupGlobalHooks = (): void => {
  // ── taskUpdate (published API hook name) ────────────────────────────────
  // This is the primary hook for task changes. It fires for both normal edits
  // (title, notes, completion…) AND for task moves between projects.
  //
  // Payload structure:
  //   { taskId, task: { projectId, … }, changes: { projectId?, title?, … } }
  //
  // When a task is moved between projects, `changes.projectId` is present and
  // contains the DESTINATION project ID. In this case we must notify ALL
  // sessions so both the origin (task removed) and destination (task added)
  // Markdown files are updated correctly.
  //
  // For normal edits, `changes.projectId` is absent and we filter to only the
  // session whose project matches `task.projectId`, avoiding unnecessary syncs
  // on unrelated projects.
  PluginAPI.registerHook('taskUpdate' as any, (...args: unknown[]) => {
    const payload = args[0] as { task?: { projectId?: string | null }; changes?: Record<string, unknown> } | undefined;
    const isProjectMove = !!payload?.changes?.projectId;
    const taskProjectId = payload?.task?.projectId ?? null;

    if (isProjectMove) {
      // Task moved between projects — both origin and destination must sync.
      log.log('[vault-bridge] taskUpdate: project move detected — notifying all sessions');
      sessions.forEach((session) => handleSpChange(session));
    } else if (taskProjectId) {
      // Normal edit — only notify the affected project's session.
      sessions.forEach((session) => {
        if (session.config.projectId === taskProjectId) {
          handleSpChange(session);
        }
      });
    } else {
      // No projectId in payload — safe fallback: notify all sessions.
      sessions.forEach((session) => handleSpChange(session));
    }
  });

  // ── anyTaskUpdate (legacy hook name) ────────────────────────────────────
  // Kept as a fallback for SP versions that fire this instead of taskUpdate.
  // The payload carries the full task state but no `changes` object, so we
  // cannot detect moves here — we filter by task.projectId for efficiency.
  // Double-debounce with taskUpdate is harmless: the debounce timer is reset
  // rather than duplicated.
  PluginAPI.registerHook(SP_HOOKS.ANY_TASK_UPDATE, (...args: unknown[]) => {
    const payload = args[0] as { task?: { projectId?: string | null } } | undefined;
    const taskProjectId = (payload?.task?.projectId ?? null) as string | null;

    if (taskProjectId) {
      sessions.forEach((session) => {
        if (session.config.projectId === taskProjectId) {
          handleSpChange(session);
        }
      });
    } else {
      sessions.forEach((session) => handleSpChange(session));
    }
  });

  // ── projectListUpdate ────────────────────────────────────────────────────
  // Documented as "fired when a project is renamed, reordered, created or
  // deleted", and a DELETION must open the missing-project dialog proactively
  // (Bug #48). BUT on the SP versions tested (18.16, macOS) this hook NEVER
  // fires — not on delete, not even on create — although SP confirms the
  // registration. The working trigger is the `action` hook below
  // (`[Task Shared] deleteProject` → isProjectDeleteAction). This registration
  // is kept as a forward/backward-compatible fallback: both paths land in
  // handleProjectListUpdate, whose per-binding dialog guard makes a double
  // trigger harmless.
  PluginAPI.registerHook(SP_HOOKS.PROJECT_LIST_UPDATE, () => {
    sessions.forEach((session) => {
      void handleProjectListUpdate(session);
    });
  });

  // ── action (generic NgRx-action hook) ───────────────────────────────────
  // Safety net for STRUCTURAL task changes that taskUpdate/anyTaskUpdate miss.
  // Adding a subtask fires only `[Task] Add SubTask` (verified via console) and
  // never reaches the task hooks, so it never auto-synced. This hook fires for
  // EVERY action, so we filter to structural task mutations (add/delete/move/
  // convert/restore of tasks & subtasks) and skip pure UI/selection/update
  // actions — those are either irrelevant or already covered by taskUpdate.
  // We cannot derive a projectId from a raw action, so we notify all sessions;
  // handleSpChange's per-session cooldown + debounce throttle the fan-out and
  // suppress the echo of our own MD→SP writes.
  try {
    PluginAPI.registerHook(SP_HOOKS.ACTION, (...args: unknown[]) => {
      const raw = args[0] as { type?: string; action?: { type?: string } } | undefined;
      const type = raw?.type ?? raw?.action?.type;
      if (typeof type !== 'string') return;
      // A project deletion is the ONLY notification we get that a bound project is
      // gone (projectListUpdate never fires — see PROJECT_DELETE_ACTION_NAMES), so
      // route it to the same proactive existence check, not to handleSpChange.
      if (isProjectDeleteAction(type)) {
        sessions.forEach((session) => {
          void handleProjectListUpdate(session);
        });
        return;
      }
      if (!isStructuralTaskAction(type)) return;
      sessions.forEach((session) => handleSpChange(session));
    });
  } catch (err) {
    log.error('[vault-bridge] could not register the "action" hook:', err);
  }
};

/**
 * Normalize an NgRx action type to a comparable key: drop the leading `[Scope]`
 * prefix(es) SP prepends (they vary by version — `[Task]` vs `[Task Shared]` —
 * and a source tag can add a second, e.g. `[a][Task] …`), then keep letters
 * only, lower-cased. So `[Task] Add SubTask` and a future `[Task Shared]
 * addSubTask` both collapse to `addsubtask`.
 */
const normalizeActionType = (type: string): string =>
  type
    .replace(/^(?:\[[^\]]*\]\s*)+/, '')
    .replace(/[^a-z]/gi, '')
    .toLowerCase();

/**
 * Structural task mutations that the taskUpdate/anyTaskUpdate hooks do NOT
 * surface and that must trigger an SP→MD write. The confirmed, load-bearing cases
 * are `[Task] Add SubTask` (console-verified in v0.3.1: adding a subtask fires
 * ONLY the generic `action` hook, never taskUpdate/anyTaskUpdate) and
 * `[Task Shared] convertToSubTask` (console-verified in v0.4.2: demoting a task to
 * a subtask via GUI drag-and-drop fires only the `action` hook — its promotion
 * mirror `convertToMainTask` was already covered). The others are
 * included defensively; most also fire anyTaskUpdate, so a miss there degrades to
 * that path rather than losing a sync.
 *
 * This is a KNOWN SET, replacing the old substring test (#9323 third review).
 * The substring test both under-matched (`add task` never matched the real
 * `addTask`) and over-matched — `remove` contains `move`, so it fired on
 * `removeTasksFromTodayTag` / `removeTagsForAllTasks` / `[Task] Remove time
 * spent`. It also only *accidentally* excluded remote applies (`[OperationLog]
 * Bulk Apply Operations`, `[SP_ALL] Load(import) all data`) because neither
 * contains "task"; had SP ever renamed one to include "task" we'd have fired a
 * full SP→MD write on every remote sync. Matching an explicit set removes both
 * hazards — none of those non-structural / remote types are in it.
 */
const STRUCTURAL_TASK_ACTION_NAMES = new Set([
  'addsubtask',
  'addtask',
  'deletetask',
  'deletetasks',
  'movesubtask',
  'movetaskup',
  'movetaskdown',
  'movetootherproject',
  'converttomaintask',
  'converttosubtask',
  'restoretask',
  'restoresubtask',
  'undodeletetask',
]);

/**
 * True for action types that structurally change tasks in a way taskUpdate/
 * anyTaskUpdate miss (see STRUCTURAL_TASK_ACTION_NAMES). Pure title/notes/done
 * edits (taskUpdate), task moves between projects (taskUpdate/changes.projectId),
 * tag/time mutations, and remote/bulk applies are all deliberately excluded.
 */
export const isStructuralTaskAction = (type: string): boolean =>
  STRUCTURAL_TASK_ACTION_NAMES.has(normalizeActionType(type));

/**
 * Actions that put a task on, or take it off, the Today list (drag to Today, plan for a
 * day, schedule, add to the Today tag). They fire only the `action` hook, so the daily
 * note would otherwise wait for the next poll. Matched by fragment because the exact
 * names differ between SP versions; a spurious match only costs one debounced daily run.
 */
export const isTodayPlanningAction = (type: string): boolean => {
  const name = normalizeActionType(type);
  return /today|plantask|plantasks|scheduletask|dueday|planfor/.test(name);
};

/**
 * Project deletions (Bug #48 — ACTUAL root cause, console-verified 2026-09-16).
 *
 * Deleting a project in SP notifies the plugin through EXACTLY ONE channel: the
 * generic `action` hook, with `[Task Shared] deleteProject`. Verified in a full
 * console capture of a delete:
 *   - `projectListUpdate` NEVER fires — it is registered (SP logs "registered for
 *     projectListUpdate" for both the background and the iframe) but is not
 *     dispatched on delete, nor even on project CREATE (`[Project] Add Project`
 *     came through as an `action` too, with no hook).
 *   - `taskUpdate` / `anyTaskUpdate` never fire either: the deleted project's tasks
 *     produce no task-hook event, so `handleSpChange` is never scheduled (zero
 *     occurrences in the whole capture).
 * So the earlier assumption — that the task-deletion path reaches
 * `divertIfProjectMissing` mid-churn — was wrong: NOTHING reached it, which is why
 * neither the dialog nor the proactive snack ever appeared until a manual Sync Now.
 *
 * These names are deliberately NOT in STRUCTURAL_TASK_ACTION_NAMES: that set feeds
 * `handleSpChange` (an SP→MD write), and a deleted project must run the
 * existence check instead — off `handleSpChange`'s cooldown, which the accompanying
 * churn would trip.
 */
const PROJECT_DELETE_ACTION_NAMES = new Set(['deleteproject']);

/**
 * True for the NgRx action(s) that delete a project — the only signal SP gives us
 * (see PROJECT_DELETE_ACTION_NAMES). Exported for the regression test.
 */
export const isProjectDeleteAction = (type: string): boolean =>
  PROJECT_DELETE_ACTION_NAMES.has(normalizeActionType(type));

/**
 * Project-change handler (Bug #48). A project DELETION must surface the
 * missing-project dialog proactively, not wait for a manual Sync Now.
 *
 * Reached from BOTH project signals: the `action` hook's `[Task Shared]
 * deleteProject` (the only one that actually fires — see
 * PROJECT_DELETE_ACTION_NAMES) and the `projectListUpdate` hook (registered but
 * never observed firing; kept as a fallback). The per-binding dialog guard in
 * `handleMissingProject` makes a double trigger harmless.
 *
 * It does NOT route through `handleSpChange`: that path is an SP→MD write gated by
 * `SP_HOOK_COOLDOWN_MS`, which the churn around a delete can trip, swallowing the
 * check entirely. `divertIfProjectMissing` is called directly (it already guards the
 * `recreatingBindings` feedback loop).
 *
 * A lagged project store (still lists the just-deleted project on the first pass) is
 * covered by a second re-check after `PROJECT_MISSING_RECHECK_MS`: present-then-absent
 * → the dialog opens on the second pass; a genuine rename/reorder stays present → fall
 * through to the normal ordering path.
 *
 * Both passes pass `proactive: true`, so `handleMissingProject` fires the snack
 * immediately (it paints from the background with no user interaction) and holds the
 * modal for `PROJECT_DELETE_SETTLE_MS` so it opens in a UI settled after the
 * delete-navigation churn.
 */
const handleProjectListUpdate = (session: SyncSession): void => {
  if (!isCurrent(session)) return;

  // Pass 1 — prompt. `proactive: true` → handleMissingProject fires the reliable
  // snack immediately and defers the churn-fragile modal past the settle window.
  void (async () => {
    if (await divertIfProjectMissing(session, true)) return;
    // Present on the first pass — either a real rename/reorder/create, or SP's
    // store had not dropped the just-deleted project yet. Re-check once to tell a
    // lagged deletion (→ dialog) apart from a real ordering change (→ normal path).
    setTimeout(() => {
      void (async () => {
        if (!isCurrent(session)) return;
        if (await divertIfProjectMissing(session, true)) return;
        handleSpChange(session);
      })();
    }, PROJECT_MISSING_RECHECK_MS);
  })();
};

const handleSpChange = (session: SyncSession): void => {
  if (Date.now() - session.lastMdToSpSyncTimestamp < SP_HOOK_COOLDOWN_MS) return;
  if (session.spToMdDebounceTimer) clearTimeout(session.spToMdDebounceTimer);

  session.spToMdDebounceTimer = setTimeout(async () => {
    if (session.syncInProgress) return;
    if (Date.now() - session.lastMdToSpSyncTimestamp < SP_HOOK_COOLDOWN_MS) return;

    session.syncInProgress = true;
    if (session.stopWatcher) session.stopWatcher();

    try {
      // Project gone? Prompt before spToMd, which would otherwise write an empty
      // file (no tasks match the missing projectId) and wipe the Markdown. On a
      // project delete this is NOT the path that fires (no task hook is dispatched
      // — see PROJECT_DELETE_ACTION_NAMES); it catches a project that vanished
      // between syncs, discovered on an unrelated SP change. Still automatic and
      // with no user interaction to follow, so it is PROACTIVE: handleMissingProject
      // fires the reliable snack and defers the churn-fragile modal.
      if (await divertIfProjectMissing(session, true)) return;
      // If the file was deleted, don't silently recreate it on an SP change —
      // prompt the user (recreate / delete binding / ignore) and abort.
      if (await divertIfFileMissing(session)) return;

      // Guard against clobbering a Markdown edit we already detected but have not
      // imported yet (#9323 third review, new blocker — the automatic SP→MD path
      // previously had no fingerprint check, unlike syncAllNow). Two cases:
      //   1. A file change is PARKED (pendingMdToSpSync) — e.g. SP is unfocused, so
      //      handleFileChange delayed the import by SYNC_DEBOUNCE_MS_MD_TO_SP. Bail:
      //      that parked import runs MD→SP first and then writes SP→MD back, so this
      //      SP change is still captured, without overwriting the pending file edit.
      //   2. No parked import, but the file's content fingerprint no longer matches
      //      the last synced one — a manual edit slipped in. Import it MD→SP FIRST
      //      (edit wins), then write SP→MD back — exactly what syncAllNow does.
      if (session.pendingMdToSpSync) return;

      const content = await readTasksFile(session.config.filePath);
      const currentHash = content === null ? null : hashContent(content);
      if (content && fileHasUnsyncedEdit(currentHash, session.lastSyncedContentHash)) {
        const result = await mdToSp(content, session.config.projectId);
        // Malformed file — leave both the file and SP as-is (no SP→MD write-back
        // that would overwrite the edit). The watcher retries on the next edit.
        if (result === 'parse-error') return;
      }

      await spToMd(session.config);
      await verifySyncState(session.config);
      await markSynced(session);
    } finally {
      if (isCurrent(session)) {
        session.stopWatcher = startFileWatcher(session.config.filePath, () => {
          handleFileChange(session);
        });
      }
      session.syncInProgress = false;
    }
  }, SYNC_DEBOUNCE_MS);
};

/**
 * Trigger an immediate bidirectional sync for all active sessions, bypassing
 * debounce timers.
 *
 * Direction is chosen per session to avoid clobbering a fresh Markdown edit:
 *
 *   - If the file's content differs from what we last synced (its fingerprint
 *     no longer matches `lastSyncedContentHash`), a manual edit may not have
 *     been imported yet — the watcher polls every ~2 s and the user can click
 *     Sync Now inside that window. So import MD→SP FIRST (the edit wins), then
 *     write SP→MD back. Content-based, not mtime-based: an editor that
 *     preserves or lowers the mtime (atomic replace, same-second save) would
 *     fool a timestamp comparison and destroy the edit (point 4).
 *   - Otherwise there is no pending file edit; run SP→MD first so the file
 *     reflects the true current SP state, capturing changes that did not fire
 *     a hook (e.g. tasks moved between projects), then read it back MD→SP.
 *
 * Either way both directions run; only the order differs. Running SP→MD first
 * unconditionally (the old behaviour) overwrote every ID-bearing line — so an
 * edit made just before Sync Now was destroyed before it was ever read.
 *
 * Used by the "Sync Now" header button.
 */
export const syncAllNow = (): void => {
  sessions.forEach((session) => {
    if (session.syncInProgress) return;

    // Cancel any pending debounce timers for both directions
    if (session.spToMdDebounceTimer) {
      clearTimeout(session.spToMdDebounceTimer);
      session.spToMdDebounceTimer = null;
    }
    if (session.mdToSpDebounceTimer) {
      clearTimeout(session.mdToSpDebounceTimer);
      session.mdToSpDebounceTimer = null;
    }

    session.syncInProgress = true;
    if (session.stopWatcher) session.stopWatcher();

    (async () => {
      // Project gone? Prompt (recreate / delete) before spToMd wipes the file.
      if (await divertIfProjectMissing(session)) return;
      // If the file is gone, prompt (recreate / delete / ignore) instead of
      // silently recreating it via spToMd, then abort this manual sync.
      if (await divertIfFileMissing(session)) return;

      // Has the file been edited since our last sync? Compare the file's
      // current content fingerprint to the one recorded at the last sync — NOT
      // its mtime (see the doc comment / point 4). If so, import it before
      // writing, so a manual edit made just before Sync Now is not clobbered.
      const content = await readTasksFile(session.config.filePath);
      const currentHash = content === null ? null : hashContent(content);
      const fileChangedSinceSync = fileHasUnsyncedEdit(
        currentHash,
        session.lastSyncedContentHash,
      );

      if (fileChangedSinceSync) {
        // MD → SP first: the pending file edit wins…
        if (content) {
          const result = await mdToSp(content, session.config.projectId);
          if (result === 'parse-error') {
            // Malformed file — leave it untouched (no SP→MD write-back that
            // would overwrite the edit) and abort this manual sync. `finally`
            // still restarts the watcher.
            return;
          }
        }
        // …then SP → MD to write the merged state back (stamps new IDs, etc.).
        await spToMd(session.config);
      } else {
        // No pending file edit: SP → MD first to capture hook-less SP changes
        // (e.g. task moves), then read any remaining differences back.
        await spToMd(session.config);
        const after = await readTasksFile(session.config.filePath);
        if (after) {
          await mdToSp(after, session.config.projectId);
        }
      }
      await markSynced(session);
    })()
      .catch((error) => {
        log.error(`[vault-bridge] syncAllNow failed for ${session.config.id}:`, error);
        PluginAPI.showSnack({
          msg: `Vault Bridge: Manual sync failed for "${session.config.filePath}".`,
          type: 'ERROR',
        });
      })
      .finally(() => {
        if (isCurrent(session)) {
          session.stopWatcher = startFileWatcher(session.config.filePath, () => {
            handleFileChange(session);
          });
        }
        session.syncInProgress = false;
      });
  });
};

/**
 * Reset module-level registration flags.
 * @internal — Only for use in automated tests; do NOT call in production code.
 */
/**
 * Tear down the whole registry: stop every session's file watcher + debounce
 * timers and clear all module-level state. Called from background.ts's onUnload
 * so reinstalling/reloading the plugin does NOT leave zombie watchers or a
 * zombie config poll running (which fought the new instance over the shared
 * persisted config and spawned duplicate projects).
 */
export const shutdownSyncRegistry = (): void => {
  disposeAllSessions();
  openDialogBindings.clear();
  recreatingBindings.clear();
  lastPromptAt.clear();
};

export const _resetForTesting = (): void => {
  hooksRegistered = false;
  focusTrackingActive = false;
  openDialogBindings.clear();
  recreatingBindings.clear();
  lastPromptAt.clear();
};

const setupWindowFocusTracking = (): void => {
  if (focusTrackingActive) return;
  if (!PluginAPI.onWindowFocusChange) return;
  focusTrackingActive = true;

  PluginAPI.onWindowFocusChange((isFocusedNow: boolean) => {
    const wasFocused = isWindowFocused;
    isWindowFocused = isFocusedNow;

    if (isFocusedNow && !wasFocused) {
      sessions.forEach((session) => {
        if (session.pendingMdToSpSync && session.mdToSpDebounceTimer) {
          clearTimeout(session.mdToSpDebounceTimer);
          session.mdToSpDebounceTimer = null;
          executeMdToSpSync(session);
        }
      });
    }
  });
};
