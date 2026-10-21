# Architecture notes

These notes describe the current `sync-md-multi` implementation before the
Obsidian-vault feature work. Paths are repository-relative.

## Entry points and build

- `src/manifest.json` is the Super Productivity plugin manifest. It declares
  the plugin id, permissions, hooks, iframe support, and Node script limits.
- `src/background/background.ts` is the build entry point. Its async IIFE
  registers the menu and header buttons, loads device-local config, migrates
  pre-v0.4.0 synced config, starts the sync registry, installs the iframe
  message handler, and registers unload cleanup.
- `src/ui/index.html` is the embedded iframe configuration UI. It communicates
  with the background for config operations; it does not own the persisted
  config.
- `scripts/build.js` bundles the background TypeScript with esbuild as an IIFE,
  copies the iframe and manifest, and creates the installable ZIP. `npm run
  build` writes `dist/plugin.js` and `sync-md-multi-v<version>.zip`.

## Binding and configuration storage

`src/background/local-config.ts` defines `SyncBindingCfg` and
`LocalUserCfgV2`. A binding currently maps one SP `projectId` to one absolute
Markdown `filePath`, with an enabled flag and optional last-known project title.
The V2 config may also store cached project names, last successful sync times,
and update-notifier state.

`loadLocalConfig()` and `saveLocalConfig()` use the background context's
`localStorage` key `sync-md-multi-config`. This is device-local by design;
absolute paths are not copied to other SP devices. The loader migrates the
legacy single-file V1 shape to V2. At startup, `background.ts` also migrates
the old synced blob once via `PluginAPI.loadSyncedData()` and clears it with
`PluginAPI.persistDataSynced('')`.

`background.ts` is the config's single writer. Its `applyConfigFromUi()` accepts
the UI-managed bindings while preserving background-owned fields. The iframe
uses `PluginAPI.onMessage` to request `getConfig`, `saveConfig`, and
`getProjects`; this bridge is feature-detected in the implementation and is not
declared in the installed `@super-productivity/plugin-api` 1.0.1 types.

## Sync direction and orchestration

`src/background/sync/sync-manager.ts` owns `SyncSession`s in a `SyncRegistry`.
`initSyncRegistry()` deduplicates enabled bindings by canonical file path,
initializes sessions, starts sequential initial sync, and installs global hooks
once. Each session owns its file watcher, debounce timers, in-progress guard,
last Markdown-to-SP timestamp, pending-import flag, and last-synced content
fingerprint.

- Markdown to SP is orchestrated by `handleFileChange()` and
  `executeMdToSpSync()`. It reads the bound file and calls `mdToSp()`. Parse
  errors abort before changing SP or writing stale SP data back. Successful
  imports are verified, then written back if needed.
- SP to Markdown is orchestrated by `handleSpChange()`, which checks for
  missing resources and pending or unsynced Markdown edits before calling
  `spToMd()`. The edit guard makes a detected Markdown edit win over a
  competing SP write.
- `syncAllNow()` performs a manual bidirectional sync. It uses a content hash
  rather than file modification time to decide whether Markdown must be
  imported first.
- `src/background/sync/verify-sync.ts` compares file and SP state after sync.
- `src/background/sync/missing-resource.ts` handles missing-file and
  missing-project dialogs, optional binding removal/marker cleanup, and project
  recreation through `PluginAPI.addProject()`.

**Deletion hazard:** `src/background/sync/generate-task-operations.ts`,
`generateTaskOperations()`, treats SP tasks not represented in the imported
Markdown as delete candidates. `mdToSp()` applies those operations. A malformed
file is protected by an early parse-error abort, but a valid partial/empty file
can still be authoritative and delete tasks. In the opposite direction,
`mergeSpIntoExistingFile()` removes a Markdown task line whose ID is absent from
the SP task map. Missing lines/files must therefore not be interpreted as
deletion intent in new multi-file behavior without an explicit safeguard.

## File watcher and loop suppression

`src/background/sync/file-watcher.ts`, `startFileWatcher()`, polls each bound
file using `PluginAPI.executeNodeScript()` and `fs.statSync()` on the interval
in `src/background/config.const.ts` (`FILE_WATCH_POLL_INTERVAL_MS`, 2 seconds).
It compares modification times and invokes the session callback when a change
is detected. The returned disposer stops that session's polling interval.

Loop suppression is also in `sync-manager.ts`. After Markdown-to-SP work,
`lastMdToSpSyncTimestamp` is updated. `handleSpChange()` suppresses SP hooks for
`SP_HOOK_COOLDOWN_MS` (2 seconds), which prevents the plugin's own SP updates
from immediately echoing back into Markdown. A separate debounce coalesces
updates. The timestamp/hash state is per session today; multiple files for a
project will need cross-file coordination rather than relying only on this
per-session cooldown.

## Markdown parser and writer

- `src/background/sync/markdown-parser.ts` exports
  `parseMarkdownWithErrors()`, `parseMarkdownWithHeader()`, and
  `parseMarkdown()`. It parses `- [ ]` / `- [x]` tasks, optional
  `<!--task-id-->` markers, and up to two task levels. Deeper indentation is
  treated as notes. It collects the document header, notes, and parse errors;
  trailing `@todo`, `@doing`, and `@done` tags are stripped from task titles.
- `src/background/sync/generate-task-operations.ts`,
  `generateTaskOperations()`, matches parsed tasks by ID (or, for unmarked
  lines, by title), creates and updates tasks, handles task nesting/order, and
  currently generates deletes for SP tasks absent from that file.
- `src/background/sync/md-to-sp.ts`, `mdToSp()`, validates parse results and
  project existence, then applies operations through
  `PluginAPI.batchUpdateForProject`.
- `src/background/sync/sp-to-md.ts`, `spToMd()` and
  `mergeSpIntoExistingFile()`, render SP tasks with task IDs and completion
  annotations. Existing non-task content is preserved; known task lines are
  refreshed, unknown IDs are removed, and new SP tasks are appended. Notes
  already in the file are preserved as authored content.
- `src/background/helper/file-utils.ts` implements file reads/writes and
  directory creation through `PluginAPI.executeNodeScript()`.

## PluginAPI calls and manifest permissions

The current implementation calls the following PluginAPI methods in its
background, sync, and UI code:

- Data: `getTasks()`, `getAllProjects()`, `addProject()`,
  `batchUpdateForProject()`, `loadSyncedData()`, and
  `persistDataSynced()`.
- File access: `executeNodeScript()`.
- UI and lifecycle: `registerMenuEntry()`, `registerHeaderButton()`,
  `showIndexHtmlAsView()`, `showSnack()`, `openDialog()`, and
  `registerHook()`.
- The background also feature-detects `onReady`, `onUnload`, `onMessage`, and
  `onWindowFocusChange`; these are not all present in the installed public
  API types. Do not treat feature detection as proof that a method is part of
  the documented API.

`src/manifest.json` currently declares these permissions:
`getTasks`, `updateTask`, `addTask`, `deleteTask`, `getAllProjects`,
`addProject`, `nodeExecution`, `persistDataSynced`, `loadSyncedData`,
`reorderTasks`, `registerHook`, `showSnack`, and `batchUpdateForProject`.
The installed `@super-productivity/plugin-api` 1.0.1 type declarations include
documented methods such as `getTasks`, `getAllProjects`, `addTask`,
`updateTask`, `addProject`, `registerHook`, and `executeNodeScript`, but do not
declare `batchUpdateForProject`. Existing code uses that method; new work must
verify it against the current guide/types before depending on it, as required by
the repository rules.
