# Technical Architecture Guide: `sync.md Multi` Plugin

## 1. Introduction to the New Architecture

The `sync.md Multi` plugin represents a significant evolution of the original `sync.md` plugin, transforming it from a single-project synchronization solution into a robust platform capable of managing multiple bindings between Super Productivity projects and Markdown files. This technical guide delves into the key architectural changes that enable this multi-project functionality.

The main motivation for this refactoring was to eliminate the limitation of a single global configuration, introducing a session-based model that isolates the synchronization state for each individual binding. This improves scalability, reliability, and user experience.

## 2. Multi-Project Data Model (`local-config.ts`)

The heart of the new architecture lies in the configuration data model, defined in `src/background/local-config.ts`. A new structure has been introduced to store multiple bindings:

```typescript
export interface SyncBindingCfg {
  id: string;        // Unique identifier for the binding
  filePath: string;  // Absolute path to the Markdown file
  projectId: string; // ID of the Super Productivity project
  enabled: boolean;  // Indicates if the binding is active
}

export interface LocalUserCfgV2 {
  version: 2;                 // Configuration schema version
  bindings: SyncBindingCfg[]; // Array of all configured bindings
}
```

A handful of `_`-prefixed fields are persisted **alongside** the bindings but kept out of the `bindings` array on purpose, so updating them never changes the bindings JSON that `applyConfigFromUi()` compares (which would trigger a full sync-registry restart): `_cachedProjects` (project id/title list for the iframe dropdown), `_lastSynced` (last successful sync time per binding, also the "has this binding ever synced" discriminator), and the self-update notifier's `_lastUpdateCheck` / `_latestVersion` / `_latestUrl`. All of these are **device-local history** rather than shared configuration.

### Device-local storage (v0.4.0)

The entire config is stored **device-locally** in the background context's own `localStorage` (`loadLocalConfig()` / `saveLocalConfig()`, key `'sync-md-multi-config'`, deliberately distinct from the built-in `sync.md`'s `'sync-md-config'`). It is **never** persisted through `PluginAPI.persistDataSynced`. This is deliberate: `persistDataSynced` is synced by Super Productivity across a user's devices, so an absolute file path configured on device A would activate on device B — and, run against a stale copy of a file-synced `.md` (Dropbox/Syncthing/iCloud) or a coincidental file at the same path, could delete tasks and propagate the deletes back. `localStorage` in Electron is on-disk and per-device, so bindings stay on the machine that created them. Each device configures its own bindings (an absolute path is meaningless on another device anyway). A **one-time migration** on first run of v0.4.0 seeds the local store from any pre-0.4.0 synced blob and then clears that blob so it stops circulating through sync (see *Migration Logic* below).

### Migration Logic

To ensure backward compatibility, `loadLocalConfig()` includes migration logic. If an old configuration (V1, which lacks `version` or `bindings` and has `filePath`) is detected, it is automatically converted to a `LocalUserCfgV2` with a single default binding. This ensures that existing users do not lose their configuration when updating the plugin.

A second, **one-time synced-blob migration** runs at boot in `background.ts` when upgrading from a pre-0.4.0 release. `currentConfig` is loaded from `localStorage`; if it is empty, the background reads the legacy synced blob via `loadSyncedData()`, and — only when the local store has no bindings — seeds it from that blob. It then calls `persistDataSynced('')` to clear the synced blob so the config stops circulating across devices. The seeding is deliberately conservative: on a device that did not create a binding it must not treat a coincidental path as authoritative; for a single device it is simply a one-time re-seed of its own config. The `persistDataSynced` / `loadSyncedData` permissions are retained in `manifest.json` **solely** for this migration.

## 3. Multi-Instance Synchronization Manager (`sync-manager.ts`)

The old `sync-manager.ts` has been replaced by a centralized `SyncRegistry` that orchestrates multiple `SyncSession`s. Each `SyncSession` is an independent instance that manages the lifecycle of a single `SyncBindingCfg`.

### `SyncSession` Interface

```typescript
export interface SyncSession {
  config: SyncBindingCfg;
  stopWatcher: (() => void) | null; // Function to stop the file watcher for this session
  syncInProgress: boolean;          // Flag to prevent concurrent synchronizations
  mdToSpDebounceTimer: ReturnType<typeof setTimeout> | null;
  spToMdDebounceTimer: ReturnType<typeof setTimeout> | null;
  lastMdToSpSyncTimestamp: number;  // Timestamp of the last MD -> SP synchronization
  pendingMdToSpSync: boolean;       // Indicates if there is a pending MD -> SP synchronization
  lastSyncedContentHash: string | null; // Content fingerprint from the end of the last successful sync; syncAllNow compares it against the file's current hash to detect an unsynced edit (content-based, not mtime-based)
  hasSyncedBefore: boolean;         // True once this binding has synced at least once (seeded from the persisted _lastSynced map); distinguishes a brand-new binding from one whose file was deleted
}
```

### `initSyncRegistry`

The `initSyncRegistry(bindings: SyncBindingCfg[])` function is the entry point for initializing the synchronization system. It performs the following actions:

1.  **Disposal of Previous Sessions**: Calls `disposeAllSessions()` to clean up any active `SyncSession` and `file-watcher`, ensuring a clean state.
2.  **Window Focus Tracking**: Sets up tracking of the Super Productivity window focus only once.
3.  **Session Initialization**: Iterates over the provided `bindings` array, starting a `SyncSession` for each enabled and valid binding using `startSyncSession()`.
4.  **Global Hooks Configuration**: Calls `setupGlobalHooks()` to register Super Productivity's *hooks* only once.

### Synchronization Flow per Session

Each `SyncSession` manages its own synchronization cycle, which includes:

*   **`startFileWatcher`**: A file watcher specific to `session.config.filePath` is started. This watcher now returns a specific `stop` function that is stored in `session.stopWatcher`, allowing each *watcher* to be stopped individually.
*   **`handleFileChange(session)`**: Invoked when the `file-watcher` detects a change in the Markdown file. It uses a *debounce* mechanism (`mdToSpDebounceTimer`) to prevent excessive synchronizations. If the Super Productivity window is focused, the MD -> SP synchronization is executed immediately; otherwise, it is delayed.
*   **`executeMdToSpSync(session)`**: Performs the synchronization from the Markdown file to Super Productivity (`mdToSp`). During this operation, the session's `file-watcher` is temporarily stopped to prevent synchronization oscillations (changes in the Markdown file caused by the SP -> MD synchronization itself).
*   **`handleSpChange(session)`**: Invoked when a Super Productivity *hook* detects a relevant change. It also uses a *debounce* (`spToMdDebounceTimer`) and a *cooldown* mechanism (`lastMdToSpSyncTimestamp`) to prevent synchronization loops with Markdown file changes.

## 4. Multi-Instance File Watcher (`file-watcher.ts`)

The `src/background/sync/file-watcher.ts` module has been refactored to support multiple instances. The `startFileWatcher` function now has the following signature:

```typescript
export const startFileWatcher = (filePath: string, onChange: () => void): (() => void) => { ... };
```

This function returns a cleanup function (`() => void`) that must be invoked to stop the specific file watcher that was started. This contrasts with the previous version that used global `startFileWatcher` and `stopFileWatcher` functions, which prevented independent management of multiple files.

The `file-watcher` continues to use `PluginAPI.executeNodeScript` to access file statistics (`fs.statSync`) and detect changes in the modification timestamp (`mtime`).

> **SP ≥ 18.10.0 — `nodeExecution` blocked for external plugins**: from SP 18.10.0, `nodeExecution` is restricted to packaged built-in plugins. Source: SP commit `7f029b1` / PR #8205 (*"fix(plugins): harden nodeExecution grants"*), addressing security advisory **GHSA-78rv-m663-4fph**. It replaces the old per-call manifest trust with a two-stage, token-based grant (`requestGrant` → `executeScript` → `revokeGrant`) issued by the Electron main process **only to packaged built-in plugins whose manifest it can verify**. SP's runtime error for others: *"Node.js execution is currently only available to built-in desktop plugins."* This blocks `executeNodeScript`, which the file watcher depends on. Tested and confirmed on SP 18.10, 18.11, and 18.12 (Linux AppImage). **Not necessarily permanent** — the commit message states uploaded plugins are rejected *"until uploaded plugin installation is moved to a main-process-owned verification path"*, so SP anticipates a future verified path for external plugins.
>
> **Update (SP ≥ 18.13.1):** file access for externally-loaded plugins was re-enabled from **SP 18.13.1** behind a one-time consent dialog. The "must remain on SP 18.9.1" restriction above applied only to the **SP 18.10.0–18.12.x** window. The plugin is verified working across **SP 18.13.1–19.0.1** — see §10. Avoid only the SP 18.10.0–18.12.x range.

## 5. UI-Background Communication

Super Productivity injects `PluginAPI` directly into the global scope of the `iframe` that renders `index.html`. Since v0.4.0 the config lives in the **background context's** device-local `localStorage` (§2), which the sandboxed iframe cannot read or write directly. All config reads/writes therefore go through a **message bridge**: the iframe posts a message to the background and the background — the single owner/writer of the config — replies. This mirrors how the built-in `sync.md` structures its background/iframe split, and replaces the pre-0.4.0 model where the iframe called `PluginAPI.persistDataSynced` directly (the cross-device hazard described in §2).

The bridge mechanism: the iframe's `sendMessage(message)` helper posts `{ type: 'PLUGIN_MESSAGE', message, messageId }` to `window.parent` and listens for the reply, which arrives as `{ type: 'PLUGIN_MESSAGE_RESPONSE', messageId, result }` — the payload is on **`result`**. The background registers `PluginAPI.onMessage(async (message) => …)` (feature-detected: it is not declared in the `^1.0.1` API types but is bound at runtime for uploaded plugins, confirmed empirically) and returns a response object per message type. There is **no** `persistedDataChanged` hook and **no** 5-second config poll anymore — the iframe and background share one process, so a change made in the panel reaches the background synchronously through the bridge.

The communication pattern is as follows:

*   **Config read (`getConfig`)**: on load the iframe sends `{ type: 'getConfig' }`; the background replies `{ success: true, config }` with the current in-memory config (`{ version, bindings, _lastSynced, _cachedProjects, … }`).
*   **Config write (`saveConfig`)**: when the user saves or deletes a binding, the iframe sends `{ type: 'saveConfig', config: { version, bindings } }` (only the fields the UI manages). The background's `applyConfigFromUi()` takes `version` + `bindings` from the message, preserves every field it owns (`_lastSynced`, `_cachedProjects`, the update-notifier state), writes `localStorage` via `persistConfig()`, and — if the bindings JSON actually changed versus `activeBindingsJson` — calls `initSyncRegistry` to restart the sessions. No 200 ms delay, no polling fallback: the write is local and synchronous.
*   **Project list — direct call first**: `loadProjects()` in the iframe calls `PluginAPI.getAllProjects()` directly at panel-open time (same approach as the original `sync.md` plugin). If the result contains more than one project it is used immediately. If only one entry is returned (Inbox — observed when the iframe context has not fully initialised yet), the function falls back to the cached list and retries automatically up to 3 times, 2 seconds apart.
*   **Project list cache (`_cachedProjects`) + `getProjects`**: `background.ts` keeps a fallback copy of the project list on the config under `_cachedProjects`, populated at startup and refreshed on every `projectListUpdate` hook. The iframe registers a `projectListUpdate` hook and, when it fires, requests the fresh list via `{ type: 'getProjects' }` (the background refreshes the cache and replies with it), so a newly created project appears without reopening the panel. If the iframe never receives that hook, the ↺ button and reopening the panel still refresh the dropdown.
*   **Project dropdown filtering**: The dropdown only shows projects that do not already have an active binding, preventing accidental dual-binding of the same project. In edit mode (when `bindingId` is set), the binding's own project is re-included so it remains selectable.
*   **Entry points**: A menu entry (`PluginAPI.registerMenuEntry`) opens the configuration panel via `PluginAPI.showIndexHtmlAsView()`. A header button (`PluginAPI.registerHeaderButton`) triggers `syncAllNow()` for an immediate bidirectional sync of all active sessions. The direction is chosen per session by a **content fingerprint**, not the file's mtime: `markSynced` records a hash of the file's contents (`session.lastSyncedContentHash`, a cyrb53 hash via `hashContent`), and if the current file hashes differently — i.e. it was edited since the last sync — MD→SP runs **first** so a fresh edit is imported before the write-back can overwrite it; otherwise SP→MD runs first to capture SP changes that did not fire a hook. Either way both directions run. Hashing the content rather than comparing timestamps closes the case where an edit preserved an equal or older mtime and was still destroyed by an unconditional SP→MD-first write.

### Self-update notifier (`update-check.ts`)

A *notifier* only — never an auto-updater, since SP exposes no self-reinstall API, so installing an update stays a manual ZIP install. On **every** app startup (and then on a 24-hour interval while the app stays open, cleared in `onUnload` like every other timer) `maybeCheckForUpdate()` fetches the latest release from the **public Codeberg** API (`.../releases/latest`). The check is deliberately **not** throttled by any persisted timestamp: each launch re-checks from scratch, so a plugin updated between launches reports the correct latest version immediately instead of being suppressed by a stale 24-hour window. The URL is hard-coded to Codeberg on purpose: it is the host end users install from, and every build therefore checks the same place. The request runs through `executeNodeScript` (a Node `https.get`, sending a `User-Agent` because Codeberg sits behind Cloudflare), not an iframe `fetch()` — the sandbox CSP would block the latter, and it is the same mechanism the file watcher uses. `parseVersion` / `isNewerVersion` compare the release tag against the build-time-injected `__PLUGIN_VERSION__` component-wise.

When a strictly newer release exists it is surfaced three ways, in decreasing prominence: a colored **snack** shown once per app launch (only from the startup check — the interval re-checks silently so it never nags mid-session); a header **button** (`upgrade` icon) that opens the release page; and a **marker in the config-panel footer** (rendered by the iframe from the persisted `_latestVersion`/`_latestUrl`, styled blue via CSS). Robustness details: a *failed* check (no `nodeExecution` consent yet, offline, timeout, parse error) resolves to `null` and is simply ignored — because every startup re-checks from scratch (no persisted throttle), the next launch retries automatically. This is what lets the notifier survive the common first-run race where the check fires before the user accepts the `nodeExecution` consent dialog. `_lastUpdateCheck` is recorded on a successful check for information only; it no longer gates whether a check runs. A successful check that finds no newer version clears any stale `_latestVersion`/`_latestUrl` so the marker disappears once the user has updated. The whole feature is fire-and-forget and never blocks or affects sync.

## 6. Global Hooks Handling

The `setupGlobalHooks()` function in `sync-manager.ts` registers four Super Productivity hooks. Hook names are stored as local `SP_HOOKS` constants or inline strings rather than referencing the `PluginHooks` enum at runtime, avoiding a `require('@super-productivity/plugin-api')` call that would fail inside the plugin IIFE. The `PluginHooks` type is still imported as `import type` for TypeScript type-checking only.

*   **`taskUpdate` (primary hook)**: Fired for all task mutations — both normal property edits (title, notes, completion) and task moves between projects. The payload includes a `changes` object that lists which fields changed. If `changes.projectId` is present, the task was moved: all sessions are notified so both the origin file (task removed) and the destination file (task added) are updated correctly. For normal edits, only the session whose `config.projectId` matches `task.projectId` is notified, avoiding unnecessary writes to unrelated files.

*   **`anyTaskUpdate` (legacy fallback)**: Kept for SP versions that fire this hook instead of `taskUpdate`. Its payload does not include a `changes` object, so move detection is not possible here. Sessions are filtered by `task.projectId`. The debounce timer in `handleSpChange` absorbs any double-fire if both hooks are dispatched for the same event.

*   **`projectListUpdate`**: Registered for project renames, reorders, creations and deletions; when it fires, all active sessions are notified so their SP→Markdown state remains consistent. In practice it has **never been observed to fire on a project deletion on SP 18.16 (macOS)** — that event reaches the background through the generic `action` hook only (see below). It is kept as a fallback for SP versions that do dispatch it, but deleted-project detection no longer depends on it.

*   **`action` (generic NgRx-action safety net)**: Fired for **every** dispatched action, so it is filtered by `isStructuralTaskAction(type)` down to structural task mutations (add / delete / move / convert / restore of tasks and subtasks). It exists because some structural changes never reach `taskUpdate` / `anyTaskUpdate` — most importantly `[Task] Add SubTask` (verified on SP 18.16), so adding a subtask never auto-synced. Pure edits (already covered by `taskUpdate`) and UI/selection actions are deliberately excluded to avoid double-syncing. A raw action carries no `projectId`, so all sessions are notified; `handleSpChange`'s per-session cooldown and debounce throttle the fan-out and suppress the echo of the plugin's own MD→SP writes.

    This hook also carries the **only** notification the plugin receives when a project is deleted: `[Task Shared] deleteProject`. It is matched by `isProjectDeleteAction(type)` (the same `normalizeActionType` normalizer, against its own one-entry known set) **before** the structural-action filter, and routed straight to the project-existence check rather than to `handleSpChange` — the latter's `SP_HOOK_COOLDOWN_MS` would swallow it, because deleting a project also deletes its tasks and those hooks have just stamped a sync. See §9.

## 7. Markdown Parser (`markdown-parser.ts`)

### User-facing behaviour: parent–child task conversion

The indent-based parent/child structure described below enables live conversion in **both directions** — editing the Markdown file directly (MD→SP), or changing a task's parent in SP itself (SP→MD, via the context menu or drag-and-drop):

- **Promote a subtask to parent**: unindent it to depth 0 → on the next sync it becomes a standalone parent task in SP.
- **Demote a parent to subtask**: indent it under another task → on the next sync it becomes a subtask of that parent.
- **Move a subtask to a different parent**: re-indent it under the new parent task.
- **Promote/demote/move a task in SP itself** *(Bug #47, shipped v0.4.2)*: changing a task's `parentId` in SP — via "convert to main task", "convert to subtask", or drag-and-drop between the root list and a subtask group — is written back to the `.md` on the next SP→MD sync, relocating the task's line to its new nesting level. See §8 for how the in-place merge detects and relocates these changes.

**Restrictions**: Tasks with a `repeatCfgId` (repeating tasks) or an `issueId` (issue-linked tasks) cannot be converted to subtasks; SP will reject the operation and leave them as parent tasks. They can still be promoted from subtask to parent without restrictions.

`parseMarkdownWithErrors` converts raw Markdown text into an array of `ParsedTask` objects. Key behaviors:

*   **Task detection**: Lines matching `/^(\s*)- \[([ x])\]\s*(?:<!--([^>]+)-->\s*)?(.*)$/` are parsed as tasks. The indent level determines parent (depth 0) vs subtask (depth 1). Tasks at depth ≥ 2 are converted to notes of the nearest ancestor.
*   **Indent auto-detection**: `detectIndentSize` infers the indent unit (2 or 4 spaces) from the most common indented task pattern in the file.
*   **Document header**: All content before the first task line is captured as `header` and preserved verbatim on SP→Markdown write-back.
*   **Notes**: The non-task, non-header lines **immediately** following a task — up to the first blank line — are appended to that task's `notes` field. A blank line ends the note.
*   **Blank lines**: A line with `line.trim() === ''` **ends the current task's note**: it resets `currentTaskIndex` so any prose after the blank is treated as loose document content, not a continuation of the preceding task's notes. Unlike a section header, a blank line leaves `parentStack` intact, so a blank line between sibling subtasks does not orphan the subtask that follows it. This mirrors the SP→Markdown write-back, where a task deletion also stops removing note lines at the first blank line — so a block separated from a task by a blank line is neither absorbed as its note on import nor removed with it on deletion. (Trade-off: a multi-paragraph note with an internal blank line only contributes its first block to the SP note; the rest stays in the file as loose content.)
*   **Section headers**: Lines matching `/^#{1,6}\s/` (Markdown headings) are treated as section dividers. They reset `currentTaskIndex` and `parentStack` so subsequent lines do not accumulate on the preceding task, and they are not added to any task's notes. Tasks after a section header are parsed normally as new top-level tasks.

### Status-tag stripping (`stripStatusTags`)

The parser strips a **trailing** status tag from each task title via `stripStatusTags()` before storing it as the SP task title, so the title stays clean. It removes `@todo`, `@doing`, or `@done` — each with an optional `(date[ time])` — but **only when the tag sits at the END of the line**; an `@word` in the middle of a title is left untouched. The strip is applied repeatedly in case several trailing tags exist. On read, the parser accepts `@done`, `@done(YYYY-MM-DD)` and `@done(YYYY-MM-DD HH:mm)` — all three mean *completed*, though the checkbox state (`[x]`) remains the source of truth for done-ness; the tag itself carries only the completion date/time.

## 8. SP→Markdown In-Place Merge (`sp-to-md.ts`)

`spToMd` now uses an **in-place merge** strategy when the Markdown file already exists. Instead of regenerating the entire file from SP data, it preserves all non-task content and updates only the task checkbox lines.

### Task-line rendering and the `@done` tag

A single helper, `buildTaskLine()`, renders **every** task line — `<indent>- [ /x] <!--id--> title[ @done(...)]` — and is used by `formatTask` (the full-regeneration path) and by all in-place-merge rebuild sites, so the emitted format is consistent everywhere.

The `@done` suffix is handled by two cooperating helpers:

*   **`formatDoneTag(task)`** derives the tag from SP state: `@done(YYYY-MM-DD HH:mm)` in local 24h time when the task is done and has a `doneOn`; a bare `@done` (no date) when it is done but `doneOn` is null; and the empty string when the task is not done.
*   **`extractDoneTag(rawTitle)`** pulls an existing trailing `@done[(date[ time])]` out of the line being replaced. This exists because **SP does not store a completion date read from the file** — after an import, `task.doneOn` is null. `buildTaskLine` therefore **preserves** the existing `@done(date)` already in the line whenever the task is still done, so a date that was imported or hand-typed survives round-trips instead of collapsing to a bare `@done`. A task **freshly completed in SP** (no existing tag in the line) has no date to preserve, so it gets its `@done` from `doneOn`.

The **no-ID title-match path** (matching a tag-less file line to an SP task by title, to stamp its `<!--id-->` in place) strips status tags before comparing, so a line like `- [x] Buy milk @done(2026-07-07 14:30)` matches its clean SP title (`Buy milk`) and is stamped in place instead of spawning a duplicate task.

**Design decision — only `@done` is written.** The plugin never writes `@todo` / `@doing`: SP exposes only a done/not-done boolean with no clean "in-progress" state, and those tags belong to the companion Taskdown app's richer status model. They are tolerated on read (`stripStatusTags`, §7) but never emitted.

### `mergeSpIntoExistingFile`

```typescript
export const mergeSpIntoExistingFile = (
  existingContent: string,
  spTaskMap: Map<string, Task>,
  orderedTasks: Task[],
): string
```

The function processes the file line by line:

*   **Task line with a known `<!--id-->` whose SP `parentId` still matches the file's placement**: the line is updated in-place — the checkbox state and title are refreshed from SP; the original indent is preserved.
*   **Task line with a known `<!--id-->` whose SP `parentId` no longer matches the file's placement** *(Bug #47 — the task was promoted, demoted, or moved to a different parent in SP, via the context menu or drag-and-drop)*: the line is **not** emitted here — a `taskStack` derives each line's parent as the file places it (the nearest preceding task with a strictly smaller indent), and a mismatch against `spTask.parentId` diverts the task into the post-loop new-task distribution, which relocates it under its new parent (or to root) at the correct indent, carrying its `@done` date and regenerating its notes at the new location. **Known limitation:** a task promoted to root level is appended at the end of the file rather than kept in its SP position (Improvement C3, unscheduled).
*   **Task line with an unknown `<!--id-->`** (task deleted in SP): the line is removed, and any immediately-following note lines (non-task, non-blank, non-section-header lines) are also removed.
*   **Task line with no `<!--id-->`**: kept exactly as-is; the ID will be stamped on the next Markdown→SP cycle.
*   **All other lines** (section headers, blank lines, notes, free-form Markdown): kept exactly as-is, unconditionally.

After processing all lines, any SP tasks whose IDs were not found in the file (new tasks added in SP) are appended at the end using `convertTasksToMarkdown`.

If the file does not exist (`readTasksFile` returns `null`), `spToMd` falls back to generating the full content with `convertTasksToMarkdown`.

### Implications

*   Section headers and blank lines within the task area survive every SP→Markdown write-back.
*   Task notes written in the Markdown file are preserved as-is; notes modified in SP are **not** written back to the file (the file is the source of truth for note content).
*   Deleted SP tasks are cleanly removed along with their trailing note lines.

## 9. Missing-Resource Handling and Plugin Teardown

A binding must never keep running in a broken state. When a synchronization discovers that a resource it depends on has disappeared — either the Markdown file or the Super Productivity project — the plugin stops the silent failure and forces the user to resolve it through a modal dialog. This logic lives in a dedicated module, `src/background/sync/missing-resource.ts`, wired into `sync-manager.ts` and `background.ts`.

### `missing-resource.ts`

The module exposes three primitives:

*   **`showMissingFileDialog`** and **`showMissingProjectDialog`**: present a modal via `PluginAPI.openDialog`. The SP API has no snack-with-buttons — `showSnack` is passive (only `msg` / `type` / `ico`, no actions) — so an actionable decision requires a real dialog.
*   **`createSpProject`**: a feature-detected wrapper over `PluginAPI.addProject`. It probes for the method before calling it, so the plugin degrades gracefully on API versions that do not expose project creation.

### Policy and dialogs

*   **Missing `.md` file (case 3a)**: dialog offers **Recreate from SP** / **Delete binding** / **Ignore**. A brand-new binding that has never synced is treated differently: its file is created silently, because there is nothing to lose. The two cases are discriminated by whether the binding has ever synced before, tracked via a persisted `_lastSynced` map keyed by binding id. A file that once existed and then vanished always prompts; a first-run binding never does.
*   **Deleted SP project (case 3b)**: the `.md` file is intact and is never touched in this path. The dialog offers **Recreate project in SP** / **Delete binding** / **Delete + clean file** / **Ignore**. *Delete + clean file* removes the binding **and** strips the hidden `<!--taskId-->` markers from the `.md` so the file is left neutral, mirroring the config-panel binding delete; both call one shared `cleanFileMarkers` helper, and the button is offered only while the file still exists (`canRecreate`). Choosing *Recreate* runs `createSpProject(title)` under the binding's last-known `projectTitle`, then `repointBinding` updates the binding's `projectId` to the newly created project, and finally the tasks are re-imported from the `.md`. Stale `<!--taskId-->` markers are stripped first via `stripTaskIds`, so tasks are created fresh rather than failing against non-existent ids. If the `.md` is also gone, only **Delete binding** / **Ignore** are offered.

### Detection

*   **`divertIfProjectMissing`** checks `getAllProjects()` and runs in **all four sync paths BEFORE the file check**. Order is critical: a deleted project would otherwise let `spToMd` write an empty file and wipe the `.md`.
*   **`divertIfFileMissing`** handles the file-missing case.
*   Both **fail open**: if the project list cannot be read, synchronization proceeds normally rather than blocking on an unverifiable condition.
*   **Proactive detection of a deleted project**: the four sync paths above only notice a deleted project when something *else* triggers a sync, so the plugin also reacts to the deletion itself. The `action` hook's `[Task Shared] deleteProject` (§6) runs the existence check for every session immediately; `PROJECT_MISSING_RECHECK_MS` re-checks once if SP's project store has not yet dropped the project, which also keeps a plain rename from being mistaken for a deletion.
*   **`handleMissingProject(session, proactive)` is the single chokepoint** every detection path funnels through, so the proactive user experience lives in exactly one place. When reached proactively it (1) fires an immediate `showSnack` heads-up — a snack is painted from the background context and survives SP's navigation — and (2) waits `PROJECT_DELETE_SETTLE_MS` (2 s) before opening the modal, because deleting the *active* project makes SP route away from that view and dismiss any modal opened inside that churn window (see §10). Measured in vivo on SP 18.16 (macOS): snack ≈ 7 ms after the deletion, dialog ≈ 2.0 s after it, and the dialog then stays open until the user chooses. The snack text is deliberately terse — `project "<title>" was deleted — opening options…` — because it only has to cover the ~2 s in which the modal cannot yet be shown; the modal that follows carries the choices. It names the **project** (`projectTitle`, which the existence check refreshes on every pass, falling back to the file's basename for a binding whose project was never seen), not the file path: an absolute path made the message unreadable, and it must not tell the user to press *Sync Now*, which the proactive dialog has made unnecessary. Its type is `INFO`, not `ERROR`: the deletion is something the user just did deliberately, and the decision itself belongs to the modal that follows.

### Robustness

*   **Single-writer config**: all configuration writes go through `persistConfig()` in `background.ts`, which writes the in-memory `currentConfig` to `localStorage` (device-local; see §5). `currentConfig` is the single source of truth — the background is the only writer, and the iframe never persists directly (it sends `saveConfig` over the bridge). `applyConfigFromUi()` takes only the `version` + `bindings` the UI manages, preserves every field the background owns (`_lastSynced`, `_cachedProjects`, the update-notifier state), and restarts the registry **only** when the bindings JSON actually changed versus `activeBindingsJson` — so purely internal updates (a `_lastSynced` timestamp, a `projectTitle` refresh) never restart it. This replaces the pre-v0.4.0 `checkForConfigChanges` + 5-second storage poll, which had to guard against adopting a stale synced read that could revert an in-flight binding repoint.
*   **Dialog guards**: guards are module-level and keyed by binding id, so they survive registry restarts. At most one dialog is shown per binding, plus a post-close cooldown. A `recreatingBindings` lock is taken at the very start of the recreate handler to break the `addProject → projectListUpdate → re-check` feedback loop. `waitForProjectVisible` polls `getAllProjects()` until the recreated project appears before the import runs.
*   **`openDialog` gotcha**: SP's `openDialog` promise resolves when the dialog is **shown**, not when a button is clicked — the button `onClick` handlers fire independently. Guard logic must therefore never rely on that promise to bound anything.

### Plugin teardown — `plugin.onUnload()`

Registering an `onUnload` handler is **mandatory**. On reload or reinstall, SP unregisters a plugin's hooks but does **not** stop its `setInterval` timers — the file watchers and the daily update-check interval. Without teardown, every reinstall left a **zombie** instance still running its timers and still able to create projects, fighting the fresh instance over the shared config; this was the cause of the runaway duplicate-project behaviour observed in testing. The `onUnload` handler calls `shutdownSyncRegistry` (which disposes every session and its file watcher), clears the daily update-check interval, and clears the persist-debounce timer. (As of v0.4.0 there is no longer a config poll interval to clear — config is device-local `localStorage` reached through the message bridge, so there is nothing to poll; see §5.)

The manifest gained the **`addProject`** permission to enable project recreation.

### Opt-in `.md` cleanup on binding delete

Deleting a binding from the config panel offers an **opt-in file cleanup** that strips the hidden `<!--…-->` sync markers, leaving the Markdown neutral (unbound). The delete confirmation is shown via SP's native `PluginAPI.openDialog` from the config iframe (three choices: **Delete binding**, **Delete + clean file**, **Cancel**), with a custom in-panel modal as a fallback when `openDialog` is not exposed in the iframe context. The cleanup itself is a plain file rewrite done via `executeNodeScript` (`sanitizeMdFile` reads the file, removes the `<!--id-->` markers with a regex that mirrors `sync-manager`'s `stripTaskIds`, and writes it back). It is strictly opt-in — deleting a binding never silently rewrites the user's file — and reports the outcome (cleaned / already clean / file not found).

## 10. Known Issues and Platform Compatibility

### SP hook naming and `nodeExecution`

The plugin loads and runs fully on **SP 18.9.1D** (macOS, Apple Silicon) — including `nodeExecution` (file read/write/sync work) — and, as of the current release, is **verified working across SP 18.13.1–19.0.1** (macOS, Apple Silicon; v0.3.0/v0.3.1 verified in vivo on 18.16.0D; 19.0.1 confirmed via daily use, no errors, no missing functionality, as of 2026-09-17). Two earlier assumptions turned out to be inaccurate for the 18.9.1D build:

- The plugin-data hook is named **`persistedDataChanged`**, not `persistedDataUpdate`. SP 18.9.1D rejects `persistedDataUpdate` via typia validation, so registering it silently fails (the hook never fires). The rename was previously assumed to be an SP 18.10.0-only change; it is already in effect in 18.9.1D. The plugin registered `persistedDataChanged` (background + iframe + `manifest.json`) through v0.3.x, when config was persisted via `persistDataSynced`. **As of v0.4.0 the plugin no longer registers this hook at all** — config is device-local `localStorage` reached through the message bridge (§5), so there is no synced-data change to listen for.
- `nodeExecution` works in 18.9.1D.

### `nodeExecution` across SP versions

- **SP 18.10.0–18.12.x** blocked `nodeExecution` for externally-loaded plugins (confirmed on 18.10, 18.11, 18.12) — a deliberate security hardening (SP commit `7f029b1` / PR #8205; see §4 note).
- **SP ≥ 18.13.1 re-opens `nodeExecution` for external/uploaded plugins** behind a native main-process consent dialog: the user clicks **Allow** once and consent persists per plugin (PR #8576, released in v18.13.1; per-plugin persistence via PR #8600; PR #8708 fixed the `spawn node ENOENT` crash in packaged macOS builds). This is **verified working on macOS M2** — including `PluginAPI.openDialog` and `PluginAPI.addProject`, which the missing-resource handling depends on (see §9).

### Platform behaviours to be aware of

- **`openDialog` resolves on show, not on click**: SP's `PluginAPI.openDialog` promise resolves as soon as the dialog is displayed, not when the user clicks a button; the button `onClick` handlers fire independently. Any guard or flow-control logic must account for this and never treat the promise resolution as a "decision made" signal (see §9).
- **`onReady` and `onUnload` are now used**: `executeNodeScript` calls and the initial sync are gated behind `plugin.onReady()` (feature-detected, with a fallback), and `plugin.onUnload()` performs teardown — stopping the persist-debounce timer, the daily update-check interval, and all file watchers via `shutdownSyncRegistry` (see §9). This aligns with SP's own built-in sync-md and prevents zombie instances on reinstall.
- **Header buttons ignore `color`**: `PluginAPI.registerHeaderButton` accepts a `color` field (`'primary' | 'accent' | 'warn'`), but SP renders header buttons neutral-gray in the toolbar regardless of its value (verified `primary`/`accent`/`warn` all identical on 18.16). The self-update button is therefore distinguished only by its `upgrade` icon; the colored/attention-grabbing signal comes from the startup snack and the (CSS-styled) config-panel footer marker instead.
- **Uploaded plugins install DEACTIVATED**: installing a plugin ZIP — including re-installing over an existing one — leaves the plugin **disabled** (verified on macOS, SP 18.16). SP keeps running the previously active instance and does not hot-load the new code until the user toggles it on by hand. When verifying a new build: uninstall → quit SP → reopen → install → **activate** → confirm the config-panel footer shows the new version *before* testing; otherwise every observation describes the old build.
- **SP dismisses a modal opened during post-delete navigation**: deleting the active project makes SP route away from that view and tear it down, and an `openDialog` opened inside that churn window is closed with no user interaction (`PluginBridge: Dialog closed` in the SP console). A proactively opened dialog must therefore be deferred past the navigation (`PROJECT_DELETE_SETTLE_MS`), and the immediate heads-up must be a snack, which paints from the background context and is not dismissed by navigation (see §9).

### Mac (Apple Silicon) — known issues

_No open Mac-specific issues._ Both previously known issues are resolved:

1. **Initial sync on new binding** *(resolved v0.1.1)*: Creating/editing a binding from the config panel did not trigger sync until an app restart. Root cause: the plugin registered the hook as `persistedDataUpdate`, which SP 18.9.1D rejects (valid name is `persistedDataChanged`), so the hook never fired and the 5-second poll fallback was not compensating (it sat behind a startup `await refreshProjectsCache()`). **Fix**: renamed the hook to `persistedDataChanged` and reordered the background IIFE so the hook and poll are wired up before that non-critical await. Verified on Mac: binding add/delete now sync without restart.

2. **"Sync Now" header button not rendered** *(resolved v0.1.0)*: On Mac 18.9.1 `PluginAPI.registerHeaderButton` registered without error but no button appeared in the SP toolbar (it worked on Linux/AppImage). Root cause was a **registration-timing race**: the button was registered at the end of the background-entry `async` IIFE, after the `loadSyncedData`/`refreshProjectsCache` awaits resolved, by which point SP had already built its header toolbar on Mac. **Fix**: `registerMenuEntry` and `registerHeaderButton` are now called synchronously at the very top of the IIFE, before any `await`, so registration is never delayed past the toolbar build. Confirmed rendering on Mac after the change.

## 11. Technical Conclusion

The refactoring to `sync.md Multi` has resulted in a modular and scalable architecture. The introduction of `SyncSession`s and a centralized `SyncRegistry`, along with a multi-instance `file-watcher`, enables efficient and isolated management of multiple synchronization flows. The in-place merge strategy in `spToMd` ensures that user-authored structure (section headers, notes, free-form Markdown) is never destroyed by a write-back, making the plugin safe for files that mix SP tasks with rich editorial content. The core business logic (`mdToSp`, `spToMd`, `generateTaskOperations`) has been kept intact and is reused within each session, minimizing risk and maximizing development efficiency.

Real-world testing hardened the binding lifecycle. As of v0.4.0, config changes from the UI reach the background **synchronously through the message bridge** (§5): the iframe sends `saveConfig`, `applyConfigFromUi()` is the single authoritative path for restarting the sync registry, and there is no polling or storage-hook indirection to race against. The project dropdown is kept fresh through a direct `getAllProjects()` call plus a `projectListUpdate` hook in the iframe that re-requests the list over the bridge, so new SP projects appear without requiring an app restart.
