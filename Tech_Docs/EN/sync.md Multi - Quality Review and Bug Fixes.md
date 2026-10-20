# sync.md Multi — Quality Review and Bug Fixes

## Overview

This document records the quality review, bug fixes and hardening applied to the multi-project `sync.md` implementation by Fernando Pindado with Claude (Anthropic).

## Bugs Identified and Fixed

Twelve bugs were found and corrected, grouped by area:

**Bug #1 — `src/index.ts`: incorrect exports**
The file was a verbatim copy of the single-project plugin's `index.ts`, referencing non-existent modules (`sync-utils`, wrong paths). Fixed by mapping each export to the actual module path in the multi-project structure.

**Bugs #2 and #3 — `LocalUserCfg` type does not exist in multi**
`sp-to-md.ts` and `verify-sync.ts` imported `LocalUserCfg` from `local-config.ts`, a type that does not exist in the multi version. The correct type is `SyncBindingCfg`. The same error affected six test files (`test-utils.ts`, `header-preservation.integration.spec.ts`, `sp-to-md.test.ts`, `verify-sync.test.ts`). All corrected.

**Bug #4 — `PROJECT_LIST_UPDATE` hook not registered**
`setupGlobalHooks()` only registered `ANY_TASK_UPDATE`. Changes to the project list (renames, deletions) did not trigger sync. Added registration of `PROJECT_LIST_UPDATE` in both `sync-manager.ts` and `manifest.json`.

**Bug #5 — Hook routing without `projectId` filtering**
The `ANY_TASK_UPDATE` callback notified all sessions indiscriminately. Fixed with payload-aware filtering: if the payload includes a `projectId`, only the sessions for the affected project are notified; otherwise, all sessions are notified as a safe fallback.

**Bug #6 — Sync errors with no user notification**
The `catch` blocks in `performInitialSync` and `executeMdToSpSync` logged the error but showed no feedback to the user. Added `PluginAPI.showSnack` calls with contextualised error messages.

**Bug #7 — `syncNow` called `initSyncRegistry` instead of `syncAllNow`**
The `syncNow` message handler in `ui-bridge.ts` invoked `initSyncRegistry(config.bindings)`, which tore down and recreated all sessions (including watcher restarts) when the user only wanted to force a sync. Implemented a new `syncAllNow()` function in `sync-manager.ts` and updated `ui-bridge.ts` to use it.

**Bug #8 — No duplicate path validation in the UI**
The binding form allowed creating two bindings pointing to the same `.md` file, which would have caused two file watchers competing over the same file and guaranteed sync loops. Added validation in the form submit handler.

**Bug #9 — `package.json` with wrong name**
`"name": "sync-md"` instead of `"name": "sync-md-multi"`. Fixed.

**Bug #10 — `SYNC_DEBOUNCE_MS_UNFOCUSED` constant unused (dead code)**
Exported from `config.const.ts` but not imported anywhere. Removed.

**Bug #11 — Redundant `ensureDirectoryExists` call in `sp-to-md.ts`**
`writeTasksFile` already calls `mkdirSync` internally if the directory does not exist. The explicit call to `ensureDirectoryExists` was redundant and generated an unnecessary import. Removed.

**Bug #12 — `validateOperations` in `generate-task-operations.ts` did not filter invalid operations**
The function computed the indices of invalid operations but then returned the full unfiltered array. Invalid operations were executed regardless, potentially causing state corruption. Fixed by filtering the array by the detected indices before the reorder/other split.

## Test Corrections

Two test files were completely out of date for the multi-project architecture:

**`sync-manager-edge-cases.test.ts`** — Rewritten to use `initSyncRegistry([mockConfig])` instead of `initSyncManager(mockConfig)`, mock of `startFileWatcher` returning `jest.fn()` as a disposer, and removed mocks for `stopFileWatcher` and `ensureDirectoryExists` (which no longer exist in multi).

**`sync-oscillation-prevention.test.ts`** — Rewritten to use `initSyncRegistry([mockConfig])`, introduced `mockDisposer = jest.fn()` to track watcher stop calls (replacing the defunct `fileWatcher.stopFileWatcher` global), and updated all related assertions.

## Final Verification Results (Round 1)

- **Tests**: 271/271 pass across 36 suites (`npm test`).
- **TypeScript**: No errors in plugin source code (`npx tsc --noEmit`). The `vite/client` entry was removed from `compilerOptions.types` and `vite.config.ts` was deleted — both were pre-existing Vite artefacts with no role in this plugin's build.
- **Runtime fix — "Dynamic require of @super-productivity/plugin-api is not supported"**: After installing the built ZIP in Super Productivity, a critical runtime error was observed. Root cause: `import { PluginHooks }` (a *value* import) caused esbuild to emit a `require('@super-productivity/plugin-api')` call inside the IIFE bundle, where `require` is not available. Fixed by changing every import from this package to `import type { ... }` (erased at build time) and introducing local `SP_HOOKS` constants in `sync-manager.ts` to hold the hook name strings at runtime. All other files (`file-utils.ts`, `file-watcher.ts`, `verify-sync.ts`, `sp-to-md.ts`, `markdown-parser.ts`, `generate-task-operations.ts`) were also updated to `import type`. The `moduleResolution` option in `tsconfig.json` was updated from the deprecated `"node"` to `"bundler"`.
- **Documentation**: Both READMEs (EN and ES) rewritten with Markdown format description, sync flow explanation, oscillation prevention, window focus behaviour, duplicate path validation, and a developer section.

---

## Round 2 — Runtime Testing Bugs (May 2026)

After the first round of fixes, the plugin was installed and tested in a real Super Productivity environment (Linux Mint 22.3, AppImage, Firefox). Eight additional bugs were found and fixed.

**Bug #13 — Project dropdown showed only "Inbox"**
SP's `getAllProjects()` called from inside a sandboxed iframe only returns the Inbox project. The full project list is only accessible from the background script context. Fixed by having `background.ts` call `getAllProjects()` at startup and whenever `projectListUpdate` fires, then storing the result in `persistDataSynced` under the key `_cachedProjects`. The iframe reads this cache via `loadSyncedData()` and populates the dropdown from `_cachedProjects`.

**Bug #14 — No menu entry to open the plugin configuration UI**
The plugin UI had no accessible entry point after installation. Fixed by registering a menu entry (`PluginAPI.registerMenuEntry`) that calls `PluginAPI.showIndexHtmlAsView()`, and a header button (`PluginAPI.registerHeaderButton`) labeled "Sync Now" that triggers an immediate SP→Markdown sync for all sessions.

**Bug #15 — Wrong SP hook names (uppercase vs camelCase)**
`SP_HOOKS.ANY_TASK_UPDATE` was set to `'ANY_TASK_UPDATE'` and `SP_HOOKS.PROJECT_LIST_UPDATE` to `'PROJECT_LIST_UPDATE'`. SP dispatches hooks in camelCase (`'anyTaskUpdate'`, `'projectListUpdate'`) as declared in `manifest.json`. The uppercase strings never matched, so SP→Markdown sync never triggered after task changes. Fixed by correcting the string values in the `SP_HOOKS` constants.

**Bug #16 — `setupGlobalHooks` called multiple times, registering duplicate handlers**
`setupGlobalHooks()` was called on every `initSyncRegistry` invocation (i.e., every time the binding configuration changed). Each call added another copy of each hook handler; after N config saves there were N copies firing on every task update. Fixed by adding a module-level `hooksRegistered` flag that ensures `setupGlobalHooks()` is called at most once per plugin lifetime. A companion `_resetForTesting()` export allows tests to reset this flag between test cases.

**Bug #17 — Initial sync did not write task IDs back to the Markdown file**
In `performInitialSync`, after calling `mdToSp` (which creates tasks in SP), a `verifySyncState` check was used to decide whether to call `spToMd`. Because SP's state may not be fully settled immediately after `batchUpdateForProject`, the verification could report "in sync" before the tasks were visible, so `spToMd` was never called and IDs were never stamped into the file. Fixed by calling `spToMd` unconditionally after `mdToSp` in the initial sync path, then running verification only for logging purposes.

**Bug #18 — Double file watcher race condition in `startSyncSession`**
`startSyncSession` called `performInitialSync(session)` (not awaited) and then immediately called `startFileWatcher`. Because `performInitialSync` stops the watcher at the start of its `finally` block and starts a new one at the end, there were two overlapping polling intervals: the one from `startSyncSession` (never properly stopped) and the one from `performInitialSync`'s `finally`. Fixed by removing the `startFileWatcher` call from `startSyncSession` entirely — `performInitialSync` already manages the full watcher lifecycle.

**Bug #19 — `setupWindowFocusTracking` registered a new listener on every `initSyncRegistry` call**
Because `setupWindowFocusTracking()` was called inside `initSyncRegistry`, and `initSyncRegistry` is called whenever bindings change, multiple focus-change listeners accumulated over time. Fixed by adding a `focusTrackingActive` module-level flag (same pattern as `hooksRegistered`) so the listener is registered only once.

**Bug #20 — Markdown section headers (`## ...`) were consumed as task notes**
Lines like `## Completed Tasks` appearing between task lines were caught by the parser's "non-task line → add to current task's notes" branch. This stripped the `##` prefix and attached the text as a note to the preceding task. Fixed in `parseMarkdownWithErrors`: lines matching `/^#{1,6}\s/` are now treated as section dividers — they reset `currentTaskIndex` and `parentStack` so subsequent lines do not accumulate on the previous task, and they are not added to any task's notes. Tasks appearing after a section header continue to be parsed normally.

## Code cleanup (same round)

- `src/background/ui-bridge.ts` deleted — the file was intentionally empty after removing the `postMessage` bridge (SP injects `PluginAPI` directly into the iframe; no bridge is needed). It was not imported anywhere.
- `src/index.ts` deleted — re-exported modules used only by the build entry point (`background.ts`); the build never referenced `index.ts`.
- Five placeholder/debug test files deleted: `debug-subtask-issue.test.ts`, `debug-subtask-cleanup.test.ts`, `subtask-order-mismatch.test.ts`, `user-exact-scenario.test.ts`, `simple-debounce.test.ts`. All contained either a single `expect(true).toBe(true)` placeholder or tested JavaScript's native `setTimeout` (not plugin logic).
- `plugin-api-mock.ts` updated: `PluginHooks.ANY_TASK_UPDATE` and `PROJECT_LIST_UPDATE` values corrected from uppercase to camelCase to match the `SP_HOOKS` constants in `sync-manager.ts`.
- `manifest.json`: removed `"onMessage"` from the permissions list — this API does not exist in SP's plugin runtime.

## Final Verification Results (Round 2)

- **Tests**: 258/258 pass across 30 suites (`npm test`). Reduction from 271/36 reflects deletion of placeholder test files.
- **TypeScript**: No errors (`npx tsc --noEmit`).

---

## Round 3 — In-place merge for SP→Markdown write-back (May 2026)

After the second round of fixes, the plugin was used with Markdown files that contained section headers (`## …`) interspersed with task lines. The initial sync correctly preserved section headers in the file (Bug #20 fix); however, every subsequent SP→Markdown write-back (`spToMd`) regenerated the file from scratch, discarding all non-task content.

**Root cause**: `spToMd` combined `convertTasksToMarkdown` (which generates the entire task block) with header extraction, then wrote the result. Section headers and other structural Markdown in the task area were not preserved in this model.

**Bug #21 — `spToMd` destroyed non-task content on every write-back**

The desired behaviour is: **only task checkbox lines should be modified**; every other line in the file (section headers, blank lines, notes, any free-form Markdown) must be preserved exactly as-is.

**Fix**: Introduced a `mergeSpIntoExistingFile` helper in `sp-to-md.ts` and updated `spToMd` to use it when the file already exists:

- **Task line with a known `<!--id-->`** → update checkbox state and title in-place; preserve original indentation.
- **Task line with an unknown `<!--id-->`** (task deleted in SP) → remove line; also remove any immediately-following note lines (non-task, non-blank, non-section-header lines).
- **Task line with no `<!--id-->`** → keep unchanged (will be stamped on the next Markdown→SP cycle).
- **All other lines** (section headers, blank lines, notes, free-form Markdown) → kept exactly as written, unconditionally.
- **New SP tasks not found in the file** → appended at the end using `convertTasksToMarkdown`.
- **File does not exist** → falls back to the existing `convertTasksToMarkdown` generate-from-scratch path.

**Consequence for notes**: Task notes in the Markdown file are now preserved as-is. Notes modified in SP are not written back to the Markdown file — the file is the source of truth for note content.

**Test updates**:
- `sp-to-md.test.ts`: Added a new `describe('mergeSpIntoExistingFile')` suite with 11 unit tests covering all merge cases (checkbox update, title rename, section header preservation, blank line preservation, note preservation, deleted task removal with notes, section header survival after deleted task, no-ID task passthrough, new task appending, document header preservation, subtask indent preservation).
- `header-preservation.integration.spec.ts`: Updated the "should handle empty header" test to use `readTasksFile` returning `null` (file does not exist → generate from scratch path), since the in-place merge path keeps pre-existing no-ID task lines rather than replacing them.

## Final Verification Results (Round 3)

- **Tests**: 271/271 pass across 30 suites (`npm test`). Increase from 258 reflects the 13 new merge tests.
- **TypeScript**: No errors (`npx tsc --noEmit`).

---

## Round 4 — Real-world testing fixes (May 2026)

**Bug #22 — In-place merge appended duplicate tasks on initial sync for files without IDs**

When `spToMd` was called after `mdToSp` during the initial sync, no-ID task lines (tasks written manually without a `<!--id-->` comment) were kept as-is by the merge. The corresponding SP tasks (just created by `mdToSp`) were not found in the file, so they were appended at the end. This left two copies of each task — the original no-ID line and the newly appended ID line — causing duplicates on the next restart.

**Fix**: `mergeSpIntoExistingFile` now attempts a title-based match for no-ID lines. If an SP task with the same title exists and has not been matched yet, the no-ID line is updated in-place with the ID stamped. Context-aware matching prefers subtask SP tasks for indented lines and parent tasks for non-indented lines, falling back to any unseen candidate. Lines with no matching SP task are kept unchanged.

**Bug #23 — `syncAllNow` (Sync Now button) was SP→MD only**

The "Sync Now" header button only triggered `spToMd`, missing any manual edits the user had made to the Markdown file since the last automatic sync.

**Fix**: `syncAllNow` now runs a full bidirectional sync — MD→SP first (imports manual file edits), then SP→MD (writes SP state back with IDs). Both debounce timers are cancelled before the sync starts.

**Bug #24 — Header button label showed old plugin name**

The `registerHeaderButton` label was `'Sync Now'` and the snack message referenced `'sync.md'` (the original single-binding plugin name).

**Fix**: Label updated to `'sync.md Multi: Sync Now'`; snack message updated to `'sync.md Multi: bidirectional sync triggered'`.

**Improvement — File path picker in binding UI**

The file path text field now has a **Browse…** button that opens an inline file browser panel built with `executeNodeScript`. The panel lists only directories and `.md` files (hidden files excluded), allows navigation into subdirectories, and fills the path field when a file is selected. The panel starts from the directory of any already-entered path, or from the home directory.

Drag & drop onto the file path field was also fixed: the document-level `dragover`/`drop` events are now suppressed to prevent Electron from opening the dropped file in the system default application. The drop handler uses `text/uri-list` from the DataTransfer object (which contains the full `file://` URI even in sandboxed iframes) to extract the absolute path.

## Final Verification Results (Round 4)

- **Tests**: 274/274 pass across 30 suites (`npm test`). Increase from 271 reflects new title-match merge tests.
- **TypeScript**: No errors (`npx tsc --noEmit`).

---

## Round 5 — Binding lifecycle and project dropdown fixes (May 2026)

Three runtime bugs were reported after real-world use of the binding management UI.

**Bug #25 — Creating or deleting a binding required an app restart**

After the user saved a new binding (or deleted one) through the configuration panel, the sync engine in the background was not picking up the change. The binding only became active (or inactive) after a full application restart.

Root cause: `persistedDataUpdate` fires immediately when `persistDataSynced` is called, before SP has fully committed the new value to storage. The handler then calls `loadSyncedData()` and reads the *previous* (stale) bindings JSON. Since it matches `activeBindingsJson`, `initSyncRegistry` is never called.

Fix: Added a 200 ms delay in the `persistedDataUpdate` handler before calling `loadSyncedData()`, giving SP time to commit the write. Additionally, extracted the detection logic into a standalone `checkForConfigChanges()` function and added a **5-second polling interval** as a reliable fallback — if the hook fires with stale data, the poll catches the change within 5 seconds. `background.ts` was also simplified: `refreshProjectsCache()` now uses a module-level `currentConfig` variable instead of taking it as a parameter, and tracks `cachedProjectsJson` to avoid redundant writes that would otherwise trigger an endless `persistedDataUpdate` loop.

**Bug #26 — A newly created SP project did not appear in the binding dropdown**

After creating a new project in Super Productivity, opening the binding configuration panel did not show the new project. The project appeared only after a full app restart.

Root cause (two compounding factors):
1. `projectListUpdate` may not fire on project *creation* (only on rename/reorder/delete) in some SP versions.
2. Even when it does fire, `refreshProjectsCache()` updates `_cachedProjects` in storage, but the UI panel had already loaded the old data and was not listening for updates.

Fix (three-layer approach, mirroring the original `sync.md` plugin):
- **Direct `getAllProjects()` call from the iframe**: `loadProjects()` now calls `PluginAPI.getAllProjects()` from the iframe directly at panel-open time (same as the original single-project plugin). If the result contains more than one project it is used immediately, giving an always-fresh list without any cache delay.
- **Cache fallback**: If `getAllProjects()` returns only one entry (Inbox — observed when the iframe context has not yet fully initialised), the `_cachedProjects` list maintained by the background is used instead.
- **Auto-retry**: If only Inbox is returned, `loadProjects()` retries automatically up to 3 times, 2 seconds apart (same retry logic as the original plugin), waiting for SP to make the full project list available.
- **`persistedDataUpdate` hook in iframe**: The UI now registers `persistedDataUpdate` in the iframe. When the background writes an updated `_cachedProjects` (e.g. after `projectListUpdate` fires), the hook reloads the project dropdown automatically — so a new project appears without the user needing to close and reopen the panel.
- **Manual ↺ Refresh button**: A small refresh button was added next to the project dropdown as a guaranteed immediate escape hatch.
- **60-second background polling**: `background.ts` now polls `getAllProjects()` every 60 seconds and updates `_cachedProjects` if the list has changed, as a belt-and-suspenders fallback in case `projectListUpdate` was never fired.

**Improvement — Project dropdown only shows unbound projects**

The project dropdown now filters out projects that already have an active binding, making it impossible to accidentally create two bindings for the same project (which would cause both Markdown files to mirror the same SP project and compete on every sync). In edit mode the binding's own project is re-included so it remains selectable. The dropdown is also rebuilt on every relevant action: panel open, Edit click, Cancel, save, and delete.

**Investigation — Drag & drop of `.md` files confirmed not possible**

A drag & drop feature for the file path field was investigated and diagnosed with console instrumentation. Result: SP captures drag events at the Electron window level before they reach the sandboxed plugin iframe — `dragenter`, `dragover`, and `drop` never fire in the iframe's JavaScript context. This is a limitation of SP's plugin sandbox architecture and cannot be worked around from within the plugin. The **Browse…** inline file browser (added in v0.0.5) remains the recommended way to select a file path without typing.

## Final Verification Results (Round 5)

- **Tests**: 274/274 pass across 30 suites (`npm test`). No test changes needed.
- **TypeScript**: No errors (`npx tsc --noEmit`).

---

## Round 6 — Task move detection & hook investigation (May 2026)

**Bug #27 — Tasks moved between projects were not reflected in Markdown files**

Moving a task from Project A to Project B via drag & drop or right-click menu did not update either Markdown file automatically. The task remained in Project A's file and never appeared in Project B's file. Pressing **Sync Now** after a move would reimport the task back to Project A (since MD→SP ran first), undoing the move.

**Investigation**: Console instrumentation was added to all candidate hooks (`anyTaskUpdate`, `taskUpdate`, `projectListUpdate`) to observe which hooks SP dispatches during a task move. Findings:

- `anyTaskUpdate` fires for normal task edits (title, notes, completion) but does **not** fire for project moves.
- `projectListUpdate` does not fire for project moves either.
- `taskUpdate` (the hook name declared in the published `PluginHooks` enum as `TASK_UPDATE = "taskUpdate"`) **does** fire for project moves. Its payload includes a `changes` object with `projectId` set to the destination project — unambiguously identifying the event as a move.

The original `sync.md` plugin uses a local (internal) build of the plugin API where `PluginHooks.ANY_TASK_UPDATE` resolves to the same string as `taskUpdate`. The multi-project version was using the raw string `'anyTaskUpdate'` (the legacy hook name), which is no longer dispatched by SP on moves.

**Fix**: `setupGlobalHooks()` now registers `taskUpdate` as the primary hook. When `changes.projectId` is present in the payload, all sessions are notified (both origin and destination files are updated). For normal edits, only the session matching `task.projectId` is notified. The `anyTaskUpdate` hook is retained as a legacy fallback for older SP versions; its debounce timer resets rather than duplicating the sync if both hooks fire for the same event.

**Fix for Sync Now order**: As a related improvement, `syncAllNow()` was updated to run SP→MD first (then MD→SP), so a manual sync also correctly captures moves that did not trigger any hook.

## Final Verification Results (Round 6)

- **Tests**: 274/274 pass across 30 suites (`npm test`). No test changes needed.
- **TypeScript**: No errors (`npx tsc --noEmit`).

---

## Round 7 — Mac header button rendering (June 2026)

**Bug #28 — "Sync Now" header button not rendered on macOS**

On macOS (Apple Silicon, SP 18.9.1) `PluginAPI.registerHeaderButton` returned without error but no button ever appeared in the SP toolbar. The same call rendered correctly on Linux (AppImage), so the API usage and button config were not at fault.

**Investigation**: The registration call sat at the **end** of the background entry-point `async` IIFE (`background.ts`), after two `await`s — `loadSyncedData()` and `refreshProjectsCache()` (which itself awaits `getAllProjects()` + `persistDataSynced()`). The menu entry (registered at the same point) appeared, but the header button did not — consistent with SP building its header toolbar **once** at plugin load while rendering the side menu reactively. On Mac the awaits resolved after the toolbar had already been built, so the late registration was never painted; on Linux the registration won the race.

**Fix**: `registerMenuEntry` and `registerHeaderButton` are now called **synchronously at the very top of the IIFE, before any `await`**, so registration always completes before SP builds the toolbar. Both calls are wrapped in `try/catch` with success/failure logging (`log.log`/`log.error`) so the dev console distinguishes "never registered" (silent API throw) from "registered but not painted" (SP-side rendering). Verified on Mac: the button now renders and the `Header button registered` log line prints.

## Final Verification Results (Round 7)

- **Tests**: 274/274 pass across 30 suites (`npm test`).
- **TypeScript**: No errors (`npx tsc --noEmit`).
- **Manual**: Button confirmed visible in SP toolbar on macOS 18.9.1 after reinstall.

---

## Round 8 — Initial sync not triggering on new binding (June 2026)

**Bug #29 — Creating/editing a binding did not trigger sync until an app restart (macOS)**

When a binding was created or edited from the config panel on macOS (SP 18.9.1D), the change was not picked up live: the binding only became active after restarting SP. On restart it worked because the startup path calls `initSyncRegistry` directly with the already-persisted config.

**Investigation**: A developer-console log (with temporary instrumentation) was decisive. It showed:

```
Uncaught (in promise) Error: Error on typia.assert(): invalid type on $input,
expect to be (… | "persistedDataChanged" | "projectListUpdate" | … )
```

SP 18.9.1D's valid hook names include **`persistedDataChanged`** but **not** `persistedDataUpdate`. The plugin (both the background entry point and the `index.html` iframe) registered `persistedDataUpdate`, which SP rejects via typia validation — so **that hook never fired**. Live config-change detection therefore depended entirely on the 5-second polling fallback, which was not compensating (it sat behind an `await refreshProjectsCache()` in the startup IIFE that could delay it).

This contradicts the project's prior assumption that the hook rename was an SP 18.10.0-only change and that `nodeExecution` was broken in newer SP — in 18.9.1D the hook is already `persistedDataChanged` and `nodeExecution` works.

**Fix**:
1. Renamed the hook `persistedDataUpdate` → `persistedDataChanged` in `background.ts`, `index.html`, and `manifest.json`.
2. Reordered the background IIFE so the `persistedDataChanged` hook and the 5-second poll are registered **before** the non-critical `void refreshProjectsCache()` (which no longer blocks detection wiring). Same class of ordering fix as the macOS header-button race (Bug #28).

## Final Verification Results (Round 8)

- **Tests**: 274/274 pass across 30 suites (`npm test`).
- **TypeScript**: No errors (`npx tsc --noEmit`).
- **Manual (macOS 18.9.1D)**: Adding a binding (3→4) and deleting one (4→3) both trigger `persistedDataChanged hook fired` → `Config change detected — restarting sync registry` and sync **without an app restart**. No typia errors in the console.

---

## Round 9 — Subtask indentation on SP→MD write-back (June 2026)

**Bug #30 (issue #12) — SP subtasks written to the Markdown file as a flat, unindented list**

When a subtask was added in SP under a parent that was **already present** in the Markdown file, the SP→MD write-back wrote the subtask flat (no indentation) and detached at the end of the file, instead of indented under its parent.

**Root cause**: `mergeSpIntoExistingFile` appends "new" SP tasks (those not already in the file) at the end via `convertTasksToMarkdown`. A new subtask whose parent was already in the file arrives there **alone** (the parent is not "new"), so `convertTasksToMarkdown` treats it as an orphan (`orphanedSubtasks` path) and renders it with no indentation. Generating a brand-new file worked, which is why the unit tests on `convertTasksToMarkdown` passed — `mergeSpIntoExistingFile` had no subtask coverage.

**Fix**: in `mergeSpIntoExistingFile`, new subtasks whose parent is already in the file are now **inserted indented, directly under that parent** (after the parent's existing subtask block), ordered by the parent's `subTaskIds`. Brand-new parents with their subtasks still append at the end (correctly nested). (In SP a parent is always created before its subtasks, so the "brand-new parent + subtasks in one write" case does not occur in practice.)

**Follow-up (from Mac testing)**: the first fix re-emitted indentation as spaces sized by character **length**. The user's files indent subtasks with a **tab** (`\t`, length 1), so the new subtask came out as a single space. Added `detectIndentString`, which detects and reuses the file's **actual** indent unit string (tab or N spaces) so new subtasks match the existing ones exactly and the parser round-trip stays consistent.

**Also**: stabilized the flaky `should not leak memory with repeated parsing` benchmark. `process.memoryUsage().heapUsed` deltas are only meaningful after a forced GC; under `npm test` (no `--expose-gc`) the delta was dominated by unrelated suite allocations. The assertion is now gated behind `global.gc` availability (run with `node --expose-gc` for the real check); `parseMarkdown` is stateless, so there is no real leak.

## Final Verification Results (Round 9)

- **Tests**: 278/278 pass across 30 suites (`npm test`), deterministic across repeated runs.
- **TypeScript**: No errors (`npx tsc --noEmit`).
- **Manual (macOS 18.9.1D)**: Adding a subtask in SP under an existing parent now writes it indented with a tab, matching the file's existing subtasks.

---

## Round 10 — Missing-resource handling & recreate flow (July 2026)

This round introduced **missing-resource handling** (v0.1.4/v0.1.5). When a sync finds that a binding's `.md` file is missing, or that its SP project has been deleted, the plugin now raises a modal dialog (`PluginAPI.openDialog`) that asks the user to **Recreate**, **Delete binding**, or **Ignore** — a binding must never keep running in a broken state. This section documents the feature build and the bugs found while testing it on SP 18.13.1 (macOS M2).

**Bug #32 — Dialog and recreate used the file name instead of the project name**

The deleted-project dialog, and the project recreated from it, were named after the binding's `.md` file rather than the SP project.

**Root cause**: the binding never stored the project's title, and SP does not expose the name of an already-deleted project — by the time the sync detects the deletion, the name is gone.

**Fix**: store `projectTitle` on the binding, captured on every sync while the project still exists. The deleted-project dialog then shows the real project name, and **Recreate** creates the new project under the original name. If a title was never captured (e.g. a project deleted before any successful sync), it falls back to the file name.

**Bug #33 — Recreating a project raised a "markdown formatting" error**

Choosing **Recreate** for a deleted project failed the import with a Markdown-formatting error.

**Root cause**: the `.md` file reimported into the freshly created project still carried the **old** project's `<!--taskId-->` markers. The import therefore generated *update* operations for tasks that no longer existed, and the batch failed.

**Fix**: `stripTaskIds` removes those markers before reimport, so every task is created anew in the new project. It also consumes the trailing space after each marker, so task titles have no stray leading space. `spToMd` then stamps the new IDs back into the file after the import succeeds.

**Bug #34 — Intermittent duplicate projects when recreating (the hard one)**

Recreating a deleted project sometimes produced **multiple projects** (4–6 observed), some created under the wrong name — a cascade rather than a single clean recreate.

**Interim hardening** (helped, but did not fully fix it): all config writes were serialized through a single queue; the in-memory config was made the source of truth so that a stale storage read could not revert an in-flight binding repoint; a per-binding dialog guard plus a post-close cooldown were added; a `recreatingBindings` lock was introduced to break the `addProject → projectListUpdate → re-check → recreate` feedback loop; and the recreate path now waits for the new project to be visible in `getAllProjects()` before importing.

**Root cause** (found via diagnostic logging): **zombie plugin instances**. SP unregisters a plugin's hooks when it is reloaded/reinstalled, but it does **not** stop the plugin's own `setInterval` timers — the 5-second config poll and the file watchers. With no teardown, every reinstall during testing left an old instance still polling, still able to show dialogs and create projects, fighting the new instance over the shared persisted config.

**Fix**: implement `plugin.onUnload()` — `shutdownSyncRegistry` disposes all sessions and watchers and clears the config poll. After a fresh SP restart (to clear any existing zombies) plus the `onUnload` build, testing produced exactly one project per user deletion, with correct names, no cascade, no config flip-flop, and no errors.

**Platform learning**: SP's `openDialog` promise resolves when the dialog is **shown**, not when a button is clicked — so guard logic cannot rely on awaiting it.

**Note (v0.1.5)**: an **Ignore** button was added to the deleted-project dialog. The earlier "no Ignore" reasoning was incomplete — a deleted project *can* be fixed externally (create a project, then re-point the binding in the config panel), so Ignore is a legitimate choice.

## Final Verification Results (Round 10)

- **Tests**: 304/304 pass across 33 suites (`npm test`).
- **TypeScript**: No errors (`npx tsc --noEmit`).
- **Build**: OK.
- **Manual (macOS 18.13.1, M2)**: Missing-file and deleted-project flows verified end-to-end — Recreate/Delete binding/Ignore all behave correctly, one project per recreate, correct names, no cascade or errors. Released as **v0.1.4** (with ZIP asset); bumped to **v0.1.5**.

---

## Round 11 — `@done` annotation + opt-in `.md` cleanup (July 2026)

This round shipped the two remaining plugin features (v0.2.1), completing the plugin's intended scope.

**Feature — `@done(YYYY-MM-DD HH:mm)` annotation**

Completing a task now writes a local-time `@done` stamp — derived from SP's `task.doneOn` — to its Markdown checkbox line; reopening the task removes it. Active tasks stay tag-less. The operation is idempotent: re-syncing a completed task does not duplicate or reshape the tag. On read, the parser strips any trailing `@todo` / `@doing` / `@done(...)` from the line so the SP task title stays clean, and it accepts the date-only, date+time, and bare forms.

Design decision: **only `@done` is written**. `@todo` / `@doing` are deliberately out of scope because SP exposes only a done/not-done state (there is no clean in-progress boolean to map to `@doing`); those tags are reserved for the Taskdown standalone app, whose model distinguishes them. Implementation: `stripStatusTags` (parser) plus `formatDoneTag` / `buildTaskLine` — a single line-renderer used everywhere a task line is emitted, so the tag format is produced in exactly one place.

**Feature — opt-in `.md` cleanup on binding delete**

Deleting a binding no longer silently leaves `<!--taskId-->` markers behind. The delete confirmation now offers three choices — **Delete binding** / **Delete + clean file** (strip the `<!--taskId-->` markers) / **Cancel** — presented via SP's native `PluginAPI.openDialog` from the config iframe, with a custom modal fallback. The file rewrite is performed with `executeNodeScript`. It is opt-in so a delete never rewrites the user's file unless they explicitly ask for it.

Two bugs were found while testing these features and fixed.

**Bug #35 — imported `@done(date)` lost on write-back**

Importing a file whose task line already carried `@done(2026-07-07 14:30)` and then syncing back collapsed it to a bare `@done` — the date was lost.

**Root cause**: the plugin is *write-only* for the completion date. SP does not store a completion date read from the file, so after import `task.doneOn` is `null`; the line was then regenerated from that null `doneOn` and produced a bare tag.

**Fix**: `extractDoneTag()` preserves an existing `@done(date)` already present in the line when the task is still done. A task freshly completed in SP (no existing tag in the file) still gets its date from `doneOn`, so both paths keep a correct timestamp.

**Bug #36 — duplicate tasks for no-ID lines carrying a status tag**

Importing new tasks written with a `@done` tag, then replicating back, left the originals without an ID and appended identical copies below — each with an ID and a bare `@done`.

**Root cause**: the in-place merge matched no-ID lines by their **raw** title, which included the `@done` tag. That raw title never equals the clean SP title, so the line was not matched and the SP task was treated as new and appended.

**Fix**: strip the status tags from the line title before title-matching, so `- [x] Task @done(...)` matches its clean SP task and gets its ID stamped in place instead of being duplicated.

## Final Verification Results (Round 11)

- **Tests**: 328/328 pass across 34 suites (`npm test`).
- **TypeScript**: No errors (`npx tsc --noEmit`).
- **Build**: OK.
- **Manual (macOS 18.13.1, M2)**: Both features verified end-to-end — `@done` write/remove on complete/reopen, imported dates preserved, opt-in file cleanup on binding delete, no duplicates. Released as **v0.2.1** (with ZIP asset); bumped to **v0.2.2**. Both remaining plugin features are closed — the plugin is feature-complete for its scope.

---

## Round 12 — Community-plugin review fixes: XSS, Sync Now, cascade (July 2026)

This round addressed the three blockers Johannes Millan raised while reviewing the community-plugins listing PR (super-productivity#9323), shipped as **v0.3.0**.

**Bug #37 — Config-UI HTML injection (XSS → RCE)**

The config panel built its binding list with `innerHTML`, interpolating project titles, file paths, and file-browser entry names directly into the markup. A project titled `<img src=x onerror=…>` — or a crafted file/directory name shown by the browser — would execute arbitrary script inside the plugin iframe, and because the plugin holds `nodeExecution` that escalates to arbitrary code on the machine.

**Root cause**: dynamic values concatenated into `innerHTML`.

**Fix**: the panel is rebuilt with `document.createElement` + `textContent` + `addEventListener`, so no dynamic value is ever parsed as markup; an `fbShowError` helper was added for file-browser errors. A jsdom regression test (`config-ui-xss.test.ts`) loads the real `index.html`, injects HTML-shaped names, and asserts zero injected `<img>` / `<script>` and no payload execution. (The plugin's own `openDialog` dialogs already HTML-escaped their values via `escapeHtml`; the odd name seen when deleting an HTML-titled project came from SP's *own* confirm dialog showing the escaped literal — safe.)

**Bug #38 — "Sync Now" could overwrite a just-made Markdown edit**

The header *Sync Now* button ran SP→MD first unconditionally, so a `.md` edit not yet imported was overwritten by SP's older state.

**Fix**: *Sync Now* now imports MD→SP first when the file changed since the last sync, else writes SP→MD first — both directions still run. (The mtime test used here was superseded in v0.3.1 by a content-hash switch, Bug #42.)

**Bug #39 — Parent delete cascaded onto a promoted child**

Deleting a parent task while promoting its child to a root task, in a single Markdown edit, deleted the child too. The parent's `delete` and the child's re-parenting `update` were sent in one `batchUpdateForProject`; SP's reducer resolves the delete against the parent's *pre-batch* `subTaskIds`, which still listed the child, so the delete cascaded onto it.

**Fix**: split the operations into two ordered batches — non-delete ops (create / update / reorder) first, deletes second — so the parent's `subTaskIds` is already empty when the delete runs and the promoted child survives. A regression test models SP's cascading reducer and fails against the old single-batch code.

## Final Verification Results (Round 12)

- **Tests**: 336/336 pass across 37 suites (`npm test`).
- **TypeScript**: No errors (`npx tsc --noEmit`).
- **Build**: OK.
- **Manual (macOS 18.16.0D, M2)**: all three fixes verified in vivo — an HTML-titled project shows as escaped text, the promoted child survives its parent's deletion, and general bidirectional sync + `@done` + binding delete all work. Released as **v0.3.0** (with ZIP asset). Verified SP range widened to **v18.13.1–v18.16**.

---

## Round 13 — Community-plugin second review: task/file-loss hardening (July 2026)

Reviewing v0.3.0 on #9323, Johannes flagged five deterministic task/file-loss paths. This round (**v0.3.1**) fixes the three in the plugin's own control (his points 2–4); point 1 (device-local config) is planned for v0.4.0, and point 5 (promotion/delete atomicity under two-device concurrency) is an upstream SP host-reducer change — both deferred. A subtask-sync bug found during testing was fixed in the same release.

**Bug #40 — Import continued past a parse error and deleted tasks**

A half-typed line such as `- [ ] <!--A-->` (a known task id but an empty title) is reported as a parse error and dropped from the parsed set. `mdToSp` only showed a warning snack and continued; reconciliation treats the parsed set as authoritative, so it generated a delete for task A — losing a real task because of a transient file state. Follow-up found in testing: even after the import aborted, the subsequent SP→MD write-back rewrote SP's old title back into the file.

**Fix**: `mdToSp` returns `'parse-error'` and stops **before** generating any operation when `parseResult.errors` is non-empty. All three callers (`executeMdToSpSync`, `performInitialSync`, `syncAllNow`) skip both the SP→MD write-back and `markSynced` on that result, so neither the SP tasks nor the file are touched. This affects single-device use too. Regression tests assert no `batchUpdateForProject` on a parse error and no write-back afterwards.

**Bug #41 — Two bindings on the same file via path aliases**

The config panel's duplicate-path guard compared raw path strings, while background I/O canonicalizes with `path.resolve`. `/tmp/tasks.md` and `/tmp/./tasks.md` passed the UI check but started two sessions on one file, corrupting it.

**Fix**: a `canonicalizePathKey` helper (collapses `.` / `..` / `//`, unifies separators) plus `dedupeBindingsByCanonicalPath`. The UI dup-check now canonicalizes via `executeNodeScript` (`path.resolve` + `realpath`), and the registry refuses canonical-duplicate bindings as a backstop.

**Bug #42 — mtime used as the destructive direction switch**

*Sync Now* decided the file had changed only when its `mtime` was newer than the last sync. An edit that preserved an equal or older timestamp, synced before the watcher imported it, made *Sync Now* pick SP→MD first and overwrite the edit.

**Fix**: replaced the mtime comparison with an in-memory last-synced **content fingerprint** (`hashContent`, a cyrb53 hash) recorded in `markSynced`; the direction switch now compares hashes, so an edit is detected regardless of its timestamp.

**Bug #43 — Adding a subtask did not auto-sync**

Creating a subtask under an existing task in SP did not trigger a write-back; only a manual *Sync Now* picked it up. Console tracing showed `[Task] Add SubTask` never reaches the `taskUpdate` / `anyTaskUpdate` hooks the plugin relied on.

**Fix**: register SP's generic `action` hook, filtered by `isStructuralTaskAction` to structural task mutations (add / delete / move / convert / restore of tasks and subtasks) so pure edits (already covered by `taskUpdate`) and UI/selection actions are ignored. It fans out to all sessions; the per-session cooldown + debounce throttle the fan-out and suppress the echo of the plugin's own MD→SP writes.

**Deferred (owner ≠ plugin)**: **Point 1** — filesystem bindings should be device-local. The whole config is synced across devices via `persistDataSynced`, so an absolute path from device A can wrongly activate on B and, if a coincidental file exists there, be treated as authoritative. Design decided (revert to the original `sync.md`'s `localStorage` + ui-bridge, device-local by construction) → **v0.4.0**. **Point 5** — under two-device concurrent edits, the two-batch fix (Bug #39) can let SP's conflict resolution reject the older promotion but accept the newer delete, cascading onto the child; the real fix is an upstream SP host-reducer change (the cascade must use the *effective pending* `subTaskIds`), after which the plugin can safely revert to one batch. Single-device users are unaffected by either.

## Final Verification Results (Round 13)

- **Tests**: 363/363 pass across 43 suites (`npm test`).
- **TypeScript**: No errors (`npx tsc --noEmit`).
- **Build**: OK.
- **Manual (macOS 18.16.0D, M2)**: parse-error abort leaves tasks and file intact, subtask add now auto-syncs, and general bidirectional sync is unaffected. Released as **v0.3.1** (with ZIP asset).

## Round 14 — Community-plugin third review: device-local config + SP→MD guard (July 2026)

Johannes's third review of #9323 approved the catalog listing in principle (he independently confirmed the shipped ZIP is a reproducible build and that the regression tests are not vacuous), confirmed points 2–4 fixed, and downgraded point 5 to non-blocking. Two blockers remained; **v0.4.0** clears both, plus the minor "while you're in there" findings. Point 5 (promotion/delete atomicity under two-device concurrency) stays a documented interim pending an upstream SP host-reducer fix.

**Config storage moved device-local (blocker 1)**

The whole config — absolute file paths and bindings — was persisted via `PluginAPI.persistDataSynced`, which SP syncs across a user's devices. The realistic hazard is not a coincidental foreign file but the bound `.md` being itself file-synced (Dropbox/Syncthing/iCloud) with a **stale copy on device B**: SuperSync and the file-sync transport are independent and unordered, so B could treat the stale file as authoritative, delete every bound-project task created since that snapshot, and propagate the deletes back to A. A related last-writer-wins effect: a device booting before it received A's config could persist `bindings: []`, and if that write won LWW, A would adopt the empty set and dispose every session.

**Fix**: config now lives in the background context's own `localStorage` (key `'sync-md-multi-config'`, distinct from the built-in `sync.md`'s key), which is device-local by construction — no synced blob to circulate. The sandboxed iframe, which cannot read that storage directly, now talks to the background through a `postMessage` **message bridge** (`getConfig` / `saveConfig` / `getProjects`); the background is the single owner and writer of the config. This mirrors the original built-in `sync.md`'s background/iframe split. A one-time boot migration seeds the local store from any pre-0.4.0 synced blob and then clears the blob. The `persistedDataChanged` hook and the 5-second config poll are gone.

**Bug #44 — Automatic SP→MD path could clobber a fresh Markdown edit**

The v0.3.1 content-fingerprint direction check (Bug #42) was added to `syncAllNow` only. An ordinary SP edit reaches `handleSpChange` via the `taskUpdate` / `anyTaskUpdate` hooks and used to run `spToMd` unconditionally after the debounce. With SP unfocused, `handleFileChange` parks a detected `.md` edit for up to 10 s; an SP change in that window overwrote the manual edit the plugin had already detected. `verifySyncState` ran in `handleSpChange` but its result was discarded.

**Fix**: `handleSpChange` now applies the same guard `syncAllNow` uses — before `spToMd` it bails if `pendingMdToSpSync` is set, reads the file, and if `fileHasUnsyncedEdit` reports an unsynced edit imports MD→SP first (aborting on `'parse-error'`), so the edit wins. A regression edits the file, fires `taskUpdate`, and asserts the import ran before the write-back.

**Bug #45 — Recreate project wrote back over a malformed file**

The *Recreate project* handler ignored `mdToSp`'s `'parse-error'` return and called `spToMd` + `markSynced` unconditionally, so recreating a project from a malformed `.md` still overwrote it — the same gap Bug #40 closed for the other callers.

**Fix**: the recreate handler now checks the `mdToSp` result and stops (with an error snack) on `'parse-error'` before any write-back.

**Bug #46 — `action`-hook filter mis-classified action types**

`isStructuralTaskAction` used a substring test that was simultaneously too narrow and too broad: it required the literal `"add task"` *with a space* (SP's real type is `[Task Shared] addTask`, so it never matched — those adds are covered by `anyTaskUpdate` anyway), and it **over-matched** `removeTasksFromTodayTag` / `removeTagsForAllTasks` / `[Task] Remove time spent` because "remove" contains "move". The substring test also only *accidentally* shielded the plugin from remote applies (`[OperationLog] Bulk Apply Operations`, `[SP_ALL] Load(import) all data`) — a rename could have fired a full SP→MD write on every remote sync.

**Fix**: replaced the substring test with a normalizer (`normalizeActionType` strips all leading `[…]` groups and non-letters) matched against a **known set** of structural action names. Regression tests assert the "remove" traps and the remote/bulk applies all return false.

**Cleanup — dead `executeNodeScript` guards removed**

`file-utils.ts` and `file-watcher.ts` guarded on `if (!PluginAPI.executeNodeScript)`, but SP binds `executeNodeScript` unconditionally (it returns `{ success: false }` off-desktop), so those branches never ran. Removed, with a NOTE explaining the off-desktop contract.

## Final Verification Results (Round 14)

- **Tests**: 384/384 pass across 46 suites (`npm test`).
- **TypeScript**: No errors (`npx tsc --noEmit`).
- **Build**: OK.
- **Manual (macOS, M2)**: device-local config load/save through the message bridge, the migration from a pre-0.4.0 synced blob, and the `handleSpChange` guard preserving a fresh `.md` edit are verified in vivo on SP before the v0.4.0 release.

---

## Round 15 — Parent/child relocation, proactive deleted-project dialog and foreign-id import (v0.4.2–v0.4.5, September 2026)

Three user-reported bugs and one UX parity gap, all found in daily use after the catalog listing.

**Bug #47 — a `parentId` change in SP was never written to the `.md`, and the next sync reverted it (v0.4.2)**

Promoting a subtask to a top-level task in SP (context menu *or* drag-and-drop) wrote nothing to the Markdown file, and the following synchronization undid the promotion in SP. The mirror case — demoting a root task into a subtask group — failed identically: the bug fires on **any** `parentId` change, in both directions.

Root cause: the in-place merge `mergeSpIntoExistingFile` re-emits every existing ID-tagged task line **keeping the file's original leading whitespace verbatim** — it refreshes the checkbox and the title, never the nesting level. So after a promotion the line stayed indented, was still parsed as a subtask, SP→MD produced a byte-identical file, and the read-back MD→SP re-parented the task under its old parent. A manual *Sync Now* reproduces it exactly: SP→MD first (a no-op here), then MD→SP (re-parent).

The fix could not simply un-indent the line in place — a promoted subtask with trailing siblings would have captured those siblings as its own subtree. Instead, the merge loop now tracks each ID-tagged line's **file parent** with an indent stack, and when a task's file placement disagrees with its SP `parentId` the line is **not** emitted and **not** marked as seen: it falls through to the post-loop new-task distribution, which already places root tasks and subtasks correctly and therefore handles both directions symmetrically. Its note lines are diverted with it, and `insertNewSubtasksUnderParents` was extended to emit a subtask's notes (a gap that also affected genuinely new subtasks). A follow-up commit made the merge reflect **subtask order and relocation position** inside a group, so a relocated task lands where SP put it rather than at the end of the group.

Root-level ordering is deliberately out of scope and documented as a known limitation: a task promoted to root is appended at the end of the file, and the next read-back reorders SP to match — functionally correct and stable in one sync, but visible.

**Bug #48 — the "SP project deleted" dialog only appeared after a manual Sync Now (v0.4.5)**

Deleting a bound project in SP produced no reaction from the plugin: the missing-project dialog (Recreate / Delete binding / Ignore) surfaced only when the user later triggered a synchronization by hand, so a broken binding could sit unnoticed.

The diagnosis took several rounds because two separate effects overlapped, and a third masked the results entirely:

- **Detection.** `projectListUpdate` was the designated deletion signal, but console captures showed it **never fires** on SP 18.16 (macOS) — and neither does `taskUpdate` / `anyTaskUpdate` for the deleted project's tasks. A project deletion reaches the plugin through exactly one channel: the generic `action` hook, as `[Task Shared] deleteProject`. That type is not a structural *task* action, so the hook's filter discarded it. Fix: `isProjectDeleteAction(type)` (the existing `normalizeActionType` against a dedicated known set) matches it ahead of the structural filter and routes it to the project-existence check for every session — deliberately **not** through `handleSpChange`, whose `SP_HOOK_COOLDOWN_MS` would swallow it.
- **Survival.** Even when the dialog was requested, it did not stay on screen: the SP console logged `PluginBridge: Dialog closed` with no user interaction. Deleting the *active* project makes SP route away from that view and tear it down, dismissing any modal opened in that churn window. Fix: `handleMissingProject(session, proactive)` — the single chokepoint all detection paths funnel through — now fires an immediate `showSnack` heads-up (a snack paints from the background context and survives the navigation) and only then waits `PROJECT_DELETE_SETTLE_MS` (2 s) before opening the modal.
- **The masking factor.** Every earlier "still broken" test run had executed the *old* code: SP installs an uploaded plugin **deactivated**, keeps running the previously active instance, and does not hot-load the new ZIP until the user toggles it on by hand. This is now recorded as a platform gotcha in the Architecture Guide, together with the verification ritual (uninstall → quit → reopen → install → activate → confirm the footer version *before* testing).

Verified in vivo on SP 18.16 (macOS) with the build confirmed active: `deleteProject` → snack ≈ 7 ms later → dialog ≈ 2.0 s later, no auto-close, no duplicate dialog, and the surviving bindings' own syncs complete inside the settle window. `project-delete-proactive.test.ts` covers the routing, the snack, the never-open-synchronously guarantee, and the rename case that must **not** trigger it.

One follow-up came out of using the fix rather than testing it: the heads-up snack still carried the pre-fix instruction to press *Sync Now*, which the proactive dialog had just made unnecessary, and it identified the binding by its absolute file path — so the message was both wrong and too long to read in the two seconds it is meant to fill. It now reads `project "<title>" was deleted — opening options…`, naming the project from `projectTitle` (refreshed on every existence check, with the file's basename as the fallback for a binding whose project was never seen). The modal that follows carries the choices, so the snack does not need to. Its type was also lowered from `ERROR` to `INFO` (v0.4.6): a red error snack overstated an event the user had just triggered on purpose.

**Bug #49 — importing a `.md` carrying foreign `<!--taskId-->` markers dropped every subtask (v0.4.5)**

Found by the user while testing Bug #48: re-binding after a project deletion is exactly the case that leaves a file full of ids the new project has never seen. Binding a Markdown file that still held task ids from another project (a copied file, or one whose project had been recreated) into a new or empty project imported only the root tasks; every subtask silently disappeared.

Root cause in `generateTaskOperations`: when none of the file's ids exist in the target project, every task is a **create**, and creates are addressed by the `temp_<line>` ids the batch mints. A subtask's `parentId`, however, was emitted as the parent's **stale foreign id** — a dangling reference — so SP dropped the subtask while accepting the root tasks. Fix: at both create sites, if the resolved parent is not present in the SP task map, the parent's `temp_${parentMd.line}` id is used instead. Three existing specs that asserted the old ids were updated to the `temp_*` form, and `repoint-foreign-ids.test.ts` locks the behaviour in (4 creates, 0 deletes, subtasks linked to the parent's temp id). Verified in vivo by the user in the same session, on the re-bind that had exposed it.

**Improvement C2 — "Delete + clean file" in the missing-project dialog (v0.4.5)**

Deleting a binding from the config panel offered *Delete binding* / *Delete + clean file* / *Cancel*, but the missing-project dialog offered only *Delete binding* — leaving the `.md` full of hidden markers exactly in the case where the file survives. The dialog now offers **Delete + clean file** as well (shown only while the file exists), and both call sites share one `cleanFileMarkers` helper. The mirror in the missing-*file* dialog is not applicable: that file is already gone.

**Documented limitation — Markdown nesting is two levels only**

SP supports a single level of subtasks, so the plugin maps exactly two Markdown levels. Task lines indented to a third level or deeper are not silently lost, but they degrade to notes on the nearest second-level subtask. Recorded in both READMEs rather than "fixed": it is a property of SP's task model, not of the parser.

## Final Verification Results (Round 15)

- **Tests**: 423/423 pass across 48 suites (`npm test`).
- **TypeScript**: No errors (`npx tsc --noEmit`).
- **Build**: OK — `sync-md-multi-v0.4.6.zip`.
- **Manual (macOS, M2, SP 18.16)**: Bug #47 verified in vivo for both directions (promotion and demotion, menu and drag-and-drop); Bug #48 verified from a clean re-install with the build confirmed **active** (snack immediately, dialog after the settle delay, dialog stays open); Improvement C2's "Delete + clean file" verified in vivo (binding removed, markers stripped, child tasks untouched); Bug #49 verified in vivo (a `.md` with foreign ids re-bound to an empty project imports its parents **and** its subtasks).

---

*Quality review and bug fixes by Fernando Pindado with Claude (Anthropic) — May–September 2026.*
