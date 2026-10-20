# sync.md Multi Plugin for Super Productivity

**English** · [Español](README_es.md)

`sync.md Multi` is an enhanced version of the original `sync.md` plugin that lets you synchronize multiple Super Productivity projects with their own independent Markdown files simultaneously.

## Contents

- [What does sync.md Multi do?](#what-does-syncmd-multi-do)
- [Markdown file format](#markdown-file-format)
- [How synchronization works](#how-synchronization-works)
- [When a file or project goes missing](#when-a-file-or-project-goes-missing)
- [Installation](#installation)
- [Configuration](#configuration)
- [Updating the plugin](#updating-the-plugin)
- [Important considerations](#important-considerations)
- [Troubleshooting](#troubleshooting)
- [For developers](#for-developers)
- [Contributing](#contributing)
- [Acknowledgements](#acknowledgements)

## What does `sync.md Multi` do?

- **Multiple project bindings**: Link any number of Super Productivity projects to their own `.md` files, each managed independently.
- **Bidirectional synchronization**: Changes made in Super Productivity are written to the Markdown file; changes made to the Markdown file are imported back into Super Productivity.
- **Task IDs preserved in Markdown**: Each task is identified by a unique ID embedded as an HTML comment (`<!--task-id-->`), enabling reliable round-trip sync without data loss.
- **Notes support**: Task notes are synced alongside task titles and completion status.
- **Header preservation**: Any YAML front matter or free-text content at the top of your `.md` file (before the first task line) is preserved when the plugin rewrites it.
- **Oscillation prevention**: After a Markdown→SP sync, the plugin suppresses redundant SP→Markdown write-backs for 2 seconds, preventing sync loops.
- **Window focus awareness**: Sync triggered by file changes runs immediately when Super Productivity is focused; it is deferred until the window regains focus otherwise.
- **Parent–child task conversion (both directions)**: Change a subtask's indentation in the Markdown file to promote it to a parent task, or indent a parent under another task to make it a subtask — the change is picked up on the next sync. The reverse also works: promoting or demoting a task **in Super Productivity** itself (via its menu or drag-and-drop) is written back to the `.md` file.
- **Coexistence**: `sync.md Multi` has a different plugin ID (`sync-md-multi`) and can be installed alongside the original `sync.md` plugin without conflicts.

## Markdown file format

The plugin uses a specific Markdown format. Tasks are represented as checkboxes with an embedded HTML comment containing the SP task ID:

```markdown
- [ ] <!--task-id-abc123--> Parent Task Title
  - [x] <!--task-id-def456--> Completed Subtask
    A note line belonging to the subtask
  - [ ] <!--task-id-ghi789--> Pending Subtask
  A note line belonging to the parent task
```

Key conventions:
- Parent tasks use no indentation; subtasks are indented with 2 spaces.
- The `<!--id-->` comment is placed after the checkbox and before the title.
- Notes appear as plain lines below their task, indented by 4 spaces (subtask notes) or 2 spaces (parent notes).
- A task's note is the text on the lines immediately below it, up to the first blank line. A blank line **ends the note** — anything after a blank line is left in the file untouched but is not attached to the task. (This mirrors deletion: removing a task only clears its note lines up to the first blank line. Note the trade-off: a note split into paragraphs by a blank line only keeps its first paragraph in Super Productivity.)
- New tasks added manually without an ID comment will be assigned one on the next sync.
- The plugin preserves any content above the first task line (headers, YAML front matter, etc.).

### Nesting depth: two levels only

Super Productivity's task model has exactly **two levels** — a parent task and its subtasks. The plugin follows that model, so only the first two indentation levels of the Markdown file are treated as tasks:

- **No indentation** → a parent (root) task.
- **One indentation level** → a subtask.
- **Two or more indentation levels** → **not** imported as tasks. Any deeper line is folded into the **notes** of the nearest level-2 subtask.

```markdown
- [ ] Level 1            → root task
    - [ ] Level 2        → subtask
        - [ ] Level 3    → becomes a NOTE on "Level 2" (not a task)
            - [ ] Level 4 → also a NOTE on "Level 2"
```

The deeper text is kept (as note content, with the literal `- [ ]` left intact), but it **loses its task nature**: its checkbox does not sync, it cannot be completed from SP, and it is not counted as a subtask. Creating a binding on a file with more than two levels does not fail — the deeper levels simply degrade to notes, and round-tripping them is not guaranteed to be lossless. **Keep files to two levels for full fidelity.** If you need deeper visual structure, write it as indented plain text inside a note (no `- [ ]` checkbox) so it travels cleanly as a note rather than being mistaken for a task.

### Section headers and other non-task content within the task area

Lines like `## Completed Tasks` that appear between task lines are treated as **section dividers** during the Markdown→SP import: they are not imported into SP as tasks and they are not attached to any task's notes. During the SP→Markdown write-back, the plugin performs an **in-place update** — only checkbox lines are modified, and every other line (section headers, blank lines, notes, free-form text) is **preserved exactly as-is**.

### Completion timestamps (`@done`)

When you complete a task in Super Productivity, the plugin appends a `@done` tag with your local completion time to that task's line in the Markdown file:

```markdown
- [x] <!--task-id-def456--> Completed Subtask @done(2026-07-07 14:30)
```

- The format is `@done(YYYY-MM-DD HH:mm)` in your local time.
- Reopening the task (un-completing it) removes the `@done` tag. Active tasks stay untagged.
- The write is **idempotent**: re-syncing an already-completed task does not rewrite the timestamp.
- When reading a file, the plugin keeps the SP task title clean — it recognises a trailing `@done`, `@done(2026-07-07)` (date only) or `@done(2026-07-07 14:30)` and strips it from the imported title.
- A date you typed into the file yourself is **preserved** across round-trips (the plugin does not overwrite an existing timestamp).

> **Note**: `@todo` and `@doing` tags are **not** written by the plugin (Super Productivity only tracks done vs. not-done). If they already appear in a file they are tolerated (kept out of the SP title) but not managed by the plugin.

This aligns the Markdown file format with the companion **Taskdown** app.

## How synchronization works

Synchronization is **bidirectional and automatic** in both directions:

- **You edit the Markdown file** → the changes are imported into Super Productivity (tasks created, updated, completed, deleted, or reordered to match the file).
- **You change something in Super Productivity** (edit a task, complete it, move it between projects…) → the change is written back to the Markdown file.

When writing back to the file, the plugin performs an **in-place merge**: it only touches the task checkbox lines. Every other line — section headers, blank lines, notes, free-form text — is preserved exactly as you wrote it. Tasks deleted in SP are removed; tasks new in SP are appended at the end. If the file does not exist yet, it is created from scratch.

To avoid sync loops, a write-back triggered right after a file→SP import is briefly suppressed. File changes are picked up immediately when Super Productivity is focused, and deferred until it regains focus otherwise.

**Manual sync** — the *Sync Now* button in the SP header forces an immediate bidirectional pass. Any edits you made to a file since its last sync are imported into Super Productivity **first** — so a change you just made is never overwritten — and then the current SP state is written back to every file.

**Initial sync** (when you create a binding or the plugin starts):
- If the `.md` file does not exist, your SP tasks are written to it (creating the file).
- If the `.md` file already exists, its tasks are imported into SP and the task IDs are stamped into the file immediately — no restart required.

## When a file or project goes missing

A binding must never keep running in a broken state. If a sync finds that a resource it depends on is gone, the plugin stops and shows a dialog asking you how to proceed. There are two cases.

**The Markdown file is missing** (deleted, moved, or on a folder/volume that is not currently available):

- **Recreate from SP** — regenerate the `.md` file from the current tasks in the bound project.
- **Delete binding** — remove the binding.
- **Ignore** — dismiss the dialog. If you restore the file yourself, the next sync continues normally. If it is still missing, the dialog reappears on the next sync.

> **Note**: Creating a brand-new binding that points at a file which does not exist yet still creates that file silently, with no dialog. The dialog only appears for a file that existed before and then went missing.

**The bound Super Productivity project was deleted** (your `.md` file is left untouched):

- **Recreate project in SP** — create a new project under its previous name, re-point the binding to it, and re-import the tasks from the `.md` file.
- **Delete binding** — remove the binding (the `.md` file stays where it is).
- **Ignore** — dismiss the dialog. Use this if you plan to create a project and re-point the binding yourself in the config panel. The dialog reappears on the next sync if the project is still missing.

If both the project **and** the `.md` file are gone, only **Delete binding** and **Ignore** are offered.

> Deleting a project never wipes your `.md` file. Your Markdown content is always preserved.

## Installation

**For users (recommended)** — install a pre-built ZIP:

1. Download the latest `sync-md-multi-v<version>.zip` from the [Codeberg releases page](https://codeberg.org/fpindado/sync-md-multi/releases).
2. **Open Super Productivity** and go to `Settings → Plugins`.
3. Click `Install Plugin from ZIP`, select the downloaded zip, and confirm.
4. `sync.md Multi` will appear in your plugin list, ready to configure.

**For developers** — build it yourself:

1. Build the plugin:
   ```sh
   npm install
   npm run build
   ```
   This produces `dist/plugin.js` and a `sync-md-multi-v<version>.zip` in the project root.
2. Install the generated ZIP via `Settings → Plugins → Install Plugin from ZIP` (same as above).

> **Desktop only**: File read/write operations require the desktop version of Super Productivity. The plugin will not function in the web or mobile versions.

> ⚠️ **SP version compatibility**: Fully working on Super Productivity **≤ 18.9.1** and **≥ 18.13.1** (verified on macOS, Apple Silicon). The **18.10.0–18.12.x** range blocks file access for externally-loaded plugins (*"Node.js execution is currently only available to built-in desktop plugins"*), so the plugin cannot sync there — **avoid that range**. From **18.13.1** file access is re-enabled behind a one-time consent dialog: the first time the plugin needs it, click **Allow** (the choice is remembered per plugin).
>
> The manifest's `minSupVersion` (10.0.0) is the minimum **plugin-API** version, not the file-access floor: syncing additionally requires the file-access support described above (SP ≤ 18.9.1 or ≥ 18.13.1).

## Configuration

1. Open the plugin configuration via the **sync.md Multi** entry in SP's left-hand menu (or the gear icon in the plugin list).
2. Under **Add New Binding**:
   - Select the Super Productivity project from the dropdown.
   - Enter the absolute path to the `.md` file (e.g., `/home/user/projects/work-tasks.md`), or click **Browse…** to navigate the filesystem. The file will be created if it does not exist.
   - Click **Add Binding**.
3. The binding appears under **Active Bindings** and sync starts immediately — no restart needed.

You can add as many bindings as you have projects. Each binding is independent — a crash or error in one does not affect the others. Each entry under **Active Bindings** also shows when it last synced.

**Note**: Each `.md` file path must be unique across all bindings. The UI will reject a duplicate path to prevent two watchers from fighting over the same file.

To modify a binding, click **Edit**. To remove it, click **Delete** — a confirmation dialog then offers three choices:

- **Delete binding** — remove the binding and leave the `.md` file untouched (its hidden `<!--…-->` sync markers stay in place).
- **Delete + clean file** — remove the binding **and** strip the hidden `<!--…-->` sync markers from the file, leaving it neutral (unbound). Use this if you want to hand the file to another tool or re-bind it cleanly later.
- **Cancel** — keep the binding.

Neither delete option removes the `.md` file itself — only the binding (and, for **Delete + clean file**, the sync markers inside it).

A **Sync Now** button in the SP header bar (labelled "sync.md Multi: Sync Now") forces an immediate **bidirectional** sync for all active bindings. The direction is chosen per file: if the file changed since its last sync, it is imported into SP **first** (so your manual edit is never overwritten) and the current SP state is written back afterwards; otherwise SP→Markdown runs first. Either way both directions run.

## Updating the plugin

The plugin checks whether a newer release is available every time Super Productivity starts, and then once a day while it stays open. If a newer release exists it lets you know: a notification when Super Productivity starts, an **upgrade** button in the header (click it to open the release page), and an "update available" marker in the config panel footer. Installing the update is always manual — SP has no way for a plugin to reinstall itself — so when you see the notice, download the new ZIP from the [Codeberg releases page](https://codeberg.org/fpindado/sync-md-multi/releases) and install it as below.

You have two options:

- **Quick update**: install the new ZIP directly from `Settings → Plugins → Install Plugin from ZIP` without uninstalling first. SP will overwrite the existing plugin files in place.
- **Clean update**: uninstall the current version first, then install the new ZIP.

Either way, your binding configuration is stored **locally on this device** (in the plugin's own local storage, not synced across devices) and is preserved across updates. Because a binding's file path is an absolute path specific to this machine, configuration is intentionally not synced between devices.

## Important considerations

- **Desktop only**: File operations are not available in the web or mobile versions of Super Productivity.
- **Editing the file while SP is open**: When you edit a bound `.md` file, the plugin detects the change (the file watcher polls the file's modification time) and imports it into SP before writing SP's state back, so a file edit is not overwritten by an unrelated SP change. When a sync runs, the direction is chosen from a **content fingerprint** of the file (not its timestamp), so a fresh edit is imported before any write-back can overwrite it. You do not normally need to pause SP before editing. The file watcher polls every couple of seconds, so if you edit *the same task line* on both sides within that brief window, the last edit the plugin sees wins — for a hand-off between the two, save the file (or click **Sync Now**) before making the matching change on the other side.
- **Moving tasks between projects**: Task moves are detected automatically. When a task is moved, both the origin file (task removed) and the destination file (task added) are updated within the normal sync debounce window.
- **Root-level ordering after promotion**: When you promote a task to root level in Super Productivity, its line may be appended at the end of the task block in the `.md` on the next write-back rather than staying in place. The content is correct and stable after that sync; only its position may shift.
- **Unique IDs in comments**: Do not remove or alter the `<!--id-->` comments in your Markdown file. They are the link between a line and its SP task. A line without an ID comment will be treated as a new task on the next sync.
- **Section headers and non-task lines are preserved**: Markdown headings (`##`, `###`, etc.) and all other non-task lines within the task area are kept exactly as-is during a SP→Markdown write-back. They are not imported into SP (no section concept in SP), but they survive write-backs intact.
- **Notes in the file are the source of truth**: Task notes in the Markdown file are preserved verbatim during SP→Markdown write-back. If you edit a task's notes inside Super Productivity, those changes will NOT be written back to the Markdown file — the file's note lines are kept as-is. Notes written in the Markdown file are, however, imported into SP on the next Markdown→SP sync.
- **Config migration**: If you were using the original `sync.md` plugin, its single-project configuration (`filePath` + `projectId`) is automatically migrated to a V2 binding on first load.

### What happens to existing SP tasks when you create a binding

The behaviour on the first sync depends on whether the `.md` file already exists:

| Situation | What happens |
|---|---|
| **File does not exist** | SP tasks are written to the new file. SP is unchanged. |
| **File exists but has no task lines** | Treated the same as a non-existent file: SP tasks are written to it. SP is unchanged. |
| **File exists and has tasks** | **The file is the source of truth.** Tasks in the file are imported into SP (created or matched by title). Tasks that exist in SP but are absent from the file are **deleted from SP**. |

> ⚠️ **Warning**: If you link a file that does not contain your existing SP tasks, those tasks will be deleted from the project. To keep existing SP tasks, either link a file that does not exist yet (SP writes them to the file) or make sure the file already contains those tasks before creating the binding.

## Troubleshooting

**Plugin can't sync on SP 18.10.0–18.12.x**
Those versions block file access for externally-loaded plugins. Upgrade to **SP ≥ 18.13.1** — it re-enables it behind a one-time consent dialog (click **Allow**) — or stay on **≤ 18.9.1**.

**Plugin does not appear or does not work**
Ensure you are using the desktop version of Super Productivity and that it supports the plugin API version this plugin targets. Try reinstalling from the ZIP.

**The project dropdown shows only "Inbox" or is missing a newly created project**
The plugin loads the project list directly from Super Productivity on every panel open, with automatic retries every 2 seconds. If only "Inbox" appears, SP may not have finished loading the project state into the iframe yet — wait a moment and the dropdown will refresh itself. You can also click the **↺** button next to the dropdown to force an immediate refresh. A newly created project should appear within a few seconds; if not, click ↺.

**Sync does not trigger after editing the file**
Verify the file path in the binding is correct and that the app has filesystem read/write permissions for that location. The file watcher polls the file's modification time (`mtime`) to detect a change; the sync direction is then chosen from a content fingerprint (see *Important considerations*). Some editors write to a temp file and rename — this should still be detected, but the **Sync Now** button in the SP header can force a refresh.

**Tasks appear duplicated after a sync**
This usually means the `<!--id-->` comments were removed or corrupted. Restore them from a backup or delete the affected tasks in SP and let the next SP→Markdown sync regenerate the file cleanly.

**Errors in the console**
Open the developer console (`Ctrl+Shift+I` / `Cmd+Option+I`) and look for `[sync-md]` prefixed messages. Errors include the binding's file path to help identify which binding is affected.

**SP→Markdown sync fires but produces no visible change**
The 2-second cooldown after a Markdown→SP sync may be suppressing the write-back. This is intentional — wait a few seconds and trigger a task update in SP to force a fresh SP→Markdown sync.

## For developers

```sh
npm install          # Install dependencies
npm run build        # Bundle the plugin + create the dist ZIP
npm test             # Run the test suite
npx tsc --noEmit     # TypeScript type check
```

Architecture and implementation details are documented in `Tech_Docs/`.

## Contributing

If you find a bug or want to propose a feature, please open an issue. Pull requests are welcome.

## Acknowledgements

`sync.md Multi` is based on the original [`sync.md`](https://github.com/super-productivity/super-productivity/tree/master/packages/plugin-dev/sync-md) plugin, created by **Johannes Millan** ([@johannesjo](https://github.com/johannesjo)), the author of [Super Productivity](https://github.com/johannesjo/super-productivity). Many thanks for the excellent foundation that made this extension possible.

The multi-project evolution was developed by Fernando Pindado together with Claude (Anthropic).

---

Based on [`sync.md`](https://github.com/super-productivity/super-productivity/tree/master/packages/plugin-dev/sync-md) by [@johannesjo](https://github.com/johannesjo) · Multi-project extension by Fernando Pindado with Claude (Anthropic)
