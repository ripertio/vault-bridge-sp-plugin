# Code review findings

Result of a `/code-review` run on 2026-10-22, branch `feature/obsidian-sync`. Ten findings, most severe first. None are fixed yet. They were reported by the review and not reproduced by hand, so confirm each one before changing code.

| # | Area | Location | Summary |
| --- | --- | --- | --- |
| 1 | Daily notes | `src/background/daily/daily-runner.ts:203` | SP tasks are created before the "changed during planning" guard, which then skips stamping their IDs |
| 2 | Daily notes | `src/background/daily/daily-runner.ts:194` | Early return skips saving the baseline after reverse updates and deletes |
| 3 | Startup | `src/background/background.ts:897` | An Inbox-only setup does not start syncing after a restart (fixed) |
| 4 | Daily notes | `src/background/background.ts:1031` | Changing the vault path does not restart the daily-note watcher |
| 5 | Daily notes | `src/background/daily/daily-runner.ts:112` | A task missing from `getTasks()` is treated as gone and its line is removed |
| 6 | Daily notes | `src/background/daily/daily-runner.ts:74` | The reverse diff uses the raw baseline, not the day-scoped one |
| 7 | Projects | `src/background/background.ts:454` | `startBindings` has no serialization and can undo its own updates (fixed) |
| 8 | Config | `src/background/local-config.ts:150` | `mergeUiConfig` can wipe or resurrect manual bindings (fixed) |
| 9 | Projects | `src/background/projects/project-dir.ts:115` | File binds only match if every caller merges bound files into the folder list (fixed) |
| 10 | Cleanup | `src/background/background.ts:494` | Dead aliases `renamedFolders` and `renamedProjects` are misleading |

## 1. Tasks created from the note can be duplicated

`daily-runner.ts:203`. SP tasks are created from typed note lines before the "note changed during planning" guard. When that guard fires, it skips the write that stamps the new IDs onto those lines.

**Scenario.** The user types `- [ ] Buy milk` in the note. Run 1 calls `PluginAPI.addTask` (line 143). Obsidian or the user saves the note, or a second concurrent run writes it, before the re-read at line 202. `current !== content` is true, so the write is skipped and the baseline is not saved. The line still has no ID, so the next run creates another "Buy milk" task, and an orphan stays in SP each time.

The startup run, the watcher's `notifyOnCreate`, `taskUpdate` and the day-change check can all start overlapping runs, because there is no mutex.

**Direction.** Stamp the IDs in a write that cannot be skipped, or re-read and merge instead of skipping. Add a lock so only one daily run is active at a time.

## 2. Baseline not saved after reverse updates

`daily-runner.ts:194`. When the forward plan has no changes, the function returns early without saving the baseline, even though reverse updates and deletes were already applied to SP.

**Scenario.** The user ticks a task in the note. The reverse step sets SP `isDone=true`, but `changes` counts only forward changes, so it is 0 and the baseline stays `isDone=false`. Later the user unchecks the task in SP. `spIsDone` (false) equals the baseline (false) and the note (true) differs from it, so the reverse step sets the SP task back to done and reverts the user's action. Lines removed from the note because SP deleted the task also stay in the baseline and are deleted again on every run.

**Direction.** Count reverse changes and deletions when deciding whether to save the baseline.

## 3. Inbox-only setup does not sync on startup

`background.ts:897`. `startBindings` runs at startup only if auto mode is enabled or manual bindings exist.

**Scenario.** The user sets only a vault path and `inboxFile`, with `projectsDir` disabled and no manual bindings. The condition is false, so no registry starts and the Inbox file is not synced after a restart. It starts syncing only after a later action calls `startBindings`, such as saving the vault settings.

**Direction.** Include a configured Inbox file in the startup condition.

**Fixed.** The startup condition in `background.ts` now also starts bindings when `inboxFile` is set.

## 4. Vault path change leaves the watcher on the old path

`background.ts:1031`. `saveVaultPath` does not re-run `startDailyNoteWatcher`, so the watcher keeps polling today's note under the old vault.

**Scenario.** Edits to the note in the new vault do not trigger a sync until the next task hook, midnight or a restart. If the old vault is gone, the watcher reports nothing.

**Direction.** Restart the watcher when the vault path changes.

## 5. Missing task treated as deleted

`daily-runner.ts:112`. A note line whose task ID is not in `PluginAPI.getTasks()` is treated as "SP task is gone" and removed when `deleteRemoved` is on. The code does not check that archived or finished tasks are still returned by `getTasks`.

**Scenario.** With `deleteRemoved` enabled, the user finishes the day in SP and tasks are archived. If `getTasks()` no longer returns them, their lines in today's note are stripped as "gone". The same applies to any partial or filtered result, since the only guard is a non-empty list.

**Direction.** Confirm what `getTasks()` returns for archived tasks. Treat a task as gone only on positive evidence, for example a deletion hook.

## 6. Stale baseline used in the reverse diff

`daily-runner.ts:74`. The reverse diff uses the raw baseline rather than the day-scoped `baselineForToday`. The code decided on line 70 that a stale baseline should not be trusted, then uses it anyway.

**Scenario.** Yesterday's baseline holds task X as `isDone=false`. Today X is carried into the note, or typed with the same ID, in a different state. The diff treats the difference as a user edit and pushes a title or `isDone` update to SP.

**Direction.** Pass `baselineForToday` to the diff.

## 7. `startBindings` has no serialization

`background.ts:454`. `startBindings` is async and is called from the folder poll, debounce, dialogs and UI messages. It mutates and persists `currentConfig` across awaits.

**Scenario.** A folder poll and a `projectListUpdate` debounce overlap. Both read the same links and `_knownFolders` and call `initSyncRegistry`, so the registry is torn down and rebuilt twice. Each call replaces `currentConfig` from a stale snapshot, so the later run can undo the other's `_projectLinks`, `_unlinkedProjectIds` or excluded updates.

**Direction.** Queue calls so they run one at a time, and re-read the config after each await before writing it.

**Fixed.** `startBindings` is now a wrapper around `runStartBindings` that runs through `createSerialQueue` (`src/background/helper/serial-queue.ts`), so runs never overlap. The one write that used a snapshot taken before the awaits (the excluded-list update) now spreads the current `projectsDir`. Tested in `src/background/helper/__tests__/serial-queue.test.ts`.

## 8. `mergeUiConfig` can wipe or resurrect bindings

`local-config.ts:150`. `mergeUiConfig` sets `bindings` to `[]` when the incoming config has no bindings.

**Scenario.** A `saveConfig` message with a missing or partial config, including one from an older panel build, wipes every manual binding. After `migrateManualBindings` moves bindings into `folderBinds`, a panel still holding the old list saves it back. The same files are then bound twice, once as a manual binding and once as a folder bind, and the duplicate-path dedupe skips one of them.

**Direction.** Keep the current bindings when the incoming config has none. Drop migrated bindings from stale panel state.

**Fixed.** `mergeUiConfig` in `src/background/local-config.ts` keeps the current bindings when a save has no `bindings` array. It drops incoming bindings whose project already has a folder bind. An explicit empty list still clears them. Tested in `src/background/__tests__/config-merge.test.ts`.

## 9. File binds depend on every caller

`project-dir.ts:115`. A manual bind to a `.md` file is matched with `folders.includes(folder)`, so it only works if the caller appends existing bound files to the folder list.

**Scenario.** `startBindings`, `getLinkTable` and the effective-bindings `listFolders` callback in `background.ts` each merge subfolders and bound files separately. A caller that passes only subfolders, such as a future call site or the folder poll's `listSubfolders`, silently drops all file binds. A bound-file project then looks like "project-only" and the plugin offers to create a folder for it. The folder poll also never notices a bound `.md` file appearing or disappearing.

**Direction.** Move the merge into one shared helper, or have the matcher take bound files as a separate argument.

**Fixed.** `listProjectEntries` in `src/background/projects/project-entries.ts` returns the sub-folders and the existing bound files together. The sync registry, the link table and the folder poll all use it, so the poll now notices a bound `.md` file appearing or disappearing. Tested in `src/background/projects/__tests__/project-entries.test.ts`.

## 10. Misleading aliases (fixed)

`background.ts:494`. `renamedFolders = folders` and `renamedProjects = projects` are never changed.

Fixed: both aliases removed, and the matcher and `findRemovedProjectFolders` call `folders` and `projects` directly.

**Impact.** The names imply the matcher sees post-rename state. Renames are only queued as dialogs, so these variables hold the pre-rename lists. This invites a future bug where someone assumes renamed names are already in effect.

**Direction.** Remove the aliases and use `folders` and `projects` directly.

## Suggested order

1. Findings 1, 2 and 6 together. They share `daily-runner.ts` and the baseline logic.
2. Finding 7, then 8 and 9, which are all about configuration and binding state.
3. Findings 3 and 4, which are small and independent.
4. Finding 5, after confirming how `getTasks()` treats archived tasks.
5. Finding 10, when touching that code.

Each fix should come with a focused test.
