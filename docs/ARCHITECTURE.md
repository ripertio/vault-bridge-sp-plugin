# Architecture

Vault Bridge is a Super Productivity (SP) plugin. A background script (`plugin.js`) does the work. A small iframe (`index.html`) is the config panel. File access goes through `PluginAPI.executeNodeScript()`, which is why the manifest asks for `nodeExecution`.

## Source layout

```
src/
├── manifest.json            plugin id, permissions, hooks
├── ui/index.html            config panel (Vault, Daily Notes, Projects, Links)
├── shared/                  logger (`[vault-bridge]` prefix), shared types
└── background/
    ├── background.ts        entry point: wiring, hooks, menu, header button, config bridge
    ├── local-config.ts      device-local config (localStorage), migrations, panel merge
    ├── vault.ts             vault path validation
    ├── update-check.ts      release notifier
    ├── helper/              file I/O, real-path checks, hashing, polling timers
    ├── sync/                task-file sync engine (one session per binding)
    ├── daily/               daily-note sync
    └── projects/            folder ↔ project reconciliation
```

Pure logic (parsing, planning, diffing) is kept apart from I/O, and the pure parts have unit tests next to them in `__tests__/`.

## Three layers

### 1. Sync engine (`sync/`)

One *binding* ties an SP project to one `.md` file. `sync-manager.ts` owns a session per binding.

- `markdown-parser.ts` reads a file into tasks (two levels, notes, `@done`, `<!--id-->` markers).
- `generate-task-operations.ts` diffs file tasks against SP tasks and produces create, update, delete and reorder operations.
- `md-to-sp.ts` applies them to SP with `batchUpdateForProject`.
- `sp-to-md.ts` merges SP state back into the file in place. Only task lines change.
- `file-watcher.ts` polls the file's mtime. Direction is then chosen from a content fingerprint, so a fresh file edit is imported before any write-back.
- `verify-sync.ts` checks the result after a write.
- `missing-resource.ts` handles a vanished file or project through SP dialogs.
- `inbox-done.ts` implements the opt-in "remove checked tasks from the Inbox file" setting.

Loop prevention: after a file → SP import, SP hooks are suppressed for `SP_HOOK_COOLDOWN_MS` (2 s, `config.const.ts`), and writes are skipped when the content fingerprint is unchanged.

### 2. Projects folder (`projects/`)

Turns a folder of folders into bindings.

- `project-dir.ts` holds the settings and matches folders to SP projects by title. Ambiguous names are never synced.
- `auto-bindings.ts` and `effective-bindings.ts` derive the bindings from that match, plus manual `folderBinds`. `migrate-bindings.ts` converts older saved bindings.
- `link-table.ts` builds the rows shown in the Links table.
- `reconcile.ts` and `reconcile-run.ts` create the missing side (a project for a folder, a folder with a task file for a project).
- `rename.ts` compares saved links (`projectId → folder name`) against current names to detect renames. It acts only when exactly one side changed. `folder-poll.ts` polls the folder list so vault renames reach SP without a manual save.
- `*-dialog.ts` ask in SP before creating, renaming or removing anything. `folder-delete.ts` handles a deleted linked folder.

**Several files per project (opt-in `syncAllFiles`).** Every `.md` file in a matched folder, subfolders included (6 levels, hidden entries and symlinks skipped), gets its own binding (`auto-<projectId>::<file>`), and each binding carries `groupPaths`, the task file first. All sessions of a project run one at a time (`withProjectLock`). An import parses all files as one list, so a task is deleted only when its `<!--id-->` is in none of them. Write-back is per file: the task file receives tasks new in SP, extra files only update lines they already hold, and a task held by another file is never copied. If a sibling cannot be read, that sync is skipped. The folder poll also watches the file list, so adding or removing a file rebuilds the bindings. Removing a file from the folder makes its tasks count as deleted at the next sync.

The plugin never removes a folder or file. This is enforced by `no-folder-delete.test.ts`.

### 3. Daily notes (`daily/`)

Sync between SP's *Today* list and `## To Dos` in the day's note.

| Step | Module | Direction |
| --- | --- | --- |
| Plan missing tasks and checkbox changes | `daily-plan.ts` | SP → note |
| Apply checkbox and title edits to lines the plugin wrote | `daily-reverse.ts` | note → SP |
| Turn ID-less checkbox lines into SP tasks | `daily-create.ts` | note → SP |
| Carry unfinished tasks into today's note | `daily-rollover.ts` | note → note |
| Orchestrate one run, honour dry-run | `daily-runner.ts` | both |
| Schedule runs, detect day change | `daily-scheduler.ts` | n/a |
| Validate settings | `daily-settings.ts` | n/a |

The reverse step compares the note with a **baseline**, the last state the plugin wrote for each task, saved per device. Without it the plugin could not tell which side changed. When both changed the same checkbox, SP wins. A baseline from a different day is not trusted for removals.

## Safety model

- **Opt-in everywhere.** Daily notes, project sync and every delete or cleanup option default to off. Daily notes also default to dry-run.
- **Path boundary.** `resolveInsideVault` rejects `..` and absolute paths. `assertRealPathInside` then resolves symlinks before every daily-note and project-folder write.
- **Confirm before structure changes.** Creating, renaming or removing a project or folder always goes through an SP dialog.
- **No silent deletes.** Deleting an SP task from a daily note needs its own setting and write mode. The plugin never deletes vault content.
- **Abort on parse errors.** A file that fails to parse is never written back over.

## Device-local state

Config lives in `localStorage` under `vault-bridge-config`. A config saved under the old `sync-md-multi-config` key is moved there on first load. It is not synced between devices, because it holds absolute paths. Besides the user settings it keeps:

| Field | Purpose |
| --- | --- |
| `_projectLinks` | project ID → folder name, the stable identity behind rename detection |
| `_unlinkedProjectIds` | projects the user unlinked, so no folder is recreated |
| `_knownFolders` | folder names at the last run, to tell a new folder from an old one |
| `_dailyBaseline`, `_dailyBaselineDay` | daily-note baseline, see above |
| `_dailyRolloverDay` | last day whose overdue tasks were rolled over |
| `_lastSynced` | last successful sync per binding, which also tells a new binding from one whose file vanished |
| `_cachedProjects` | project list for the sandboxed panel |

The panel owns only `version` and `bindings`. `mergeUiConfig` keeps every other field when the panel saves.

## Undocumented SP APIs

The plugin follows the documented plugin API wherever it can. These uses go beyond the published types in `@super-productivity/plugin-api` 1.0.1. They are accepted exceptions: the sync depends on them.

| Use | Where | Notes |
| --- | --- | --- |
| `dueDay` on created tasks | `daily-note.ts` (`ScheduledTaskFields`) | Schedules a task created from a daily note. |
| `anyTaskUpdate` and `projectListUpdate` hooks | `manifest.json` | Used to react to task and project changes. |
| `batchUpdateForProject` | `sync/md-to-sp.ts` | Applies a whole import in one call. Verified live for the Inbox project. |

Two more assumptions come from observing live SP data and are isolated in one constant each:

| Assumption | Constant |
| --- | --- |
| The virtual *Today* tag has the ID `TODAY`, and its `taskIds` are the tasks planned for today | `TODAY_TAG_ID` in `daily-note.ts` |
| The Inbox is the project with ID `INBOX_PROJECT` (or a null project) | `INBOX_PROJECT_ID` in `daily-plan.ts` |

If an SP release changes any of these, the failure is likely to be an empty daily note or an unsynced Inbox. Check these first.

## Build and test

- `scripts/build.js` bundles `background.ts` with esbuild into `dist/plugin.js`, copies `index.html` with the version injected, and writes `vault-bridge-v<version>.zip`.
- Tests run with Jest and ts-jest against a mock of `PluginAPI` (`src/background/__tests__/plugin-api-mock.ts`). `performance-benchmarks.test.ts` guards sync speed.
- `TEST_Obsidian_Vault/` is a scratch vault for manual testing and is git-ignored.

## Further reading

- [markdown-format.md](markdown-format.md): task line syntax, binding behaviour, troubleshooting.
