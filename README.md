# Vault Bridge for Super Productivity

Vault Bridge keeps [Super Productivity](https://super-productivity.com) (SP) and an [Obsidian](https://obsidian.md) vault in step. Your SP projects become folders of Markdown task files, the tasks you plan for today appear in your daily note, and your SP Inbox lives in a single file. Edits flow both ways.

It runs inside SP as a plugin. It needs no Obsidian plugin, because it reads and writes ordinary `.md` files in the vault.

> Vault Bridge is a fork of [`sync-md-multi`](https://codeberg.org/fpindado/sync-md-multi) by Fernando Pindado (MIT), which is itself built on the original `sync.md` plugin. The multi-file sync engine comes from that project. The vault features (projects folder, daily notes, Inbox) are new. See [Credits](#credits).

## What it does

| Area | SP side | Vault side |
| --- | --- | --- |
| **Projects** | One SP project per folder | `Projects/<Project>/backlog.md`, plus any other `.md` files in the folder (optional) |
| **Daily note** | Tasks planned for **Today** | `## To Dos` section of `Daily/YYYY-MM-DD.md` |
| **Inbox** | Tasks that belong to no project | One file you choose, e.g. `Inbox/Unsorted.md` |
| **Manual bindings** | Any SP project | Any `.md` file |

- **Two-way task sync.** Titles, checkboxes, notes, order and sub-tasks follow edits on either side.
- **Stable task IDs.** Each task line carries its SP ID as an HTML comment (`<!--id-->`), so renames and moves never create duplicates. Obsidian hides these comments in reading view.
- **Folder-driven projects.** Create a folder and the plugin offers to create the SP project. Create an SP project and it offers to create the folder. Renames propagate in both directions, always after a confirmation dialog in SP.
- **Several files per project (optional).** Every `.md` file in a project folder, subfolders included, can sync with the same SP project. Notes such as `ideas.md` keep their own tasks, and new SP tasks go to `backlog.md`.
- **Daily notes.** Today's planned tasks are added to the note, under a heading you choose. Checkbox and title edits sync both ways. Lines you type under it become new SP tasks scheduled for that day. A line you delete means "not today": the task leaves Today and stays in its project or the Inbox. Unfinished tasks can roll over to the next day's note. Moving a task to Today in SP updates the note within a few seconds.
- **Safety first.** Every vault feature is **off by default**. Daily notes start in **dry-run**, which only logs what it would do. The plugin never removes a vault file or folder. Deleting SP tasks for real from a daily note is opt-in. Removing a project or folder always needs a confirmation dialog.

## Requirements

- Super Productivity **10.0.0 or later**, desktop app (the plugin uses Node execution to read and write files).
- An Obsidian vault on the same machine, or any folder of Markdown files.

## Installation

1. Build the plugin (see [Development](#development)) or take a release zip.
2. In SP, open **Plugins → Install from ZIP** and choose `vault-bridge-v<version>.zip` from the repo root.
3. Grant the permissions the plugin asks for. `nodeExecution` is required, because SP's plugin sandbox cannot touch the file system without it.
4. Open the **Vault Bridge** entry in the SP side menu to configure it.

## Configuration

Settings are stored per device, because they hold absolute paths. Each section has its own **Save** button and applies immediately.

### Vault

| Setting | Meaning |
| --- | --- |
| Vault path | Absolute path of the vault. Every other path is relative to it and is checked to stay inside it, symlinks included. |
| Inbox file | Vault-relative `.md` file for Inbox tasks. Leave empty to skip the Inbox. |
| Remove checked tasks from the Inbox file | Off by default. Done tasks leave the file so it does not grow. The SP task stays. An unchecked line in the file wins over a done task in SP. |

### Daily Notes

| Setting | Default | Meaning |
| --- | --- | --- |
| Enable daily notes | off | Nothing is read or written for daily notes until this is on. |
| Write to the note | off (dry-run) | While off, the plugin only logs what it would change. |
| Delete the SP task when its line is removed | off | Opt-in, write mode only. Off: removing a line only takes the task off Today and keeps it in SP. |
| Roll unfinished tasks into today's note | off | Once per day, carries unchecked tasks from the latest earlier note (up to 7 days back) into today's `## To Dos`. |
| Heading for tasks in the note | `## To Dos` | Tasks are added under this heading. Without a leading `#`, `## ` is added. The section ends at the next heading of the same or a higher level. |
| Daily notes folder | `Daily` | Inside the vault. |
| Filename format | `YYYY-MM-DD` | Tokens `YYYY`, `MM`, `DD`. A live preview shows today's name. |

The note must already exist and contain the heading. An empty note gets the heading added. Nothing else in the note is touched.

```markdown
## To Dos
- [x] <!--JMj9SescyhvLnlE-92QP3--> Plan the week
- [ ] <!--oJgwZ7c7H-xxwtcbHTafy--> Write the report
- [ ] Call the dentist          ← no ID yet: becomes an SP task on the next sync
```

### Projects

| Setting | Default | Meaning |
| --- | --- | --- |
| Sync every folder under the projects folder | off | Each sub-folder maps to the SP project with the same title. |
| Projects folder | `Projects` | Relative to the vault path. |
| Task file name | `backlog.md` | Created inside each project folder. New SP tasks are written to this file. |
| Sync every .md file in a project folder | off | Other `.md` files in the folder, subfolders included (6 levels), sync with the same project. See below. |
| Ask when a linked folder is deleted | off | Asks in SP whether to unlink the project or remove it. |
| Exclude removed projects | off | A project removed in SP is added to the excluded list, so its folder is not offered again. |
| Excluded | empty | Folder names and project titles to leave out on both sides. |

#### Several files per project

With **Sync every .md file** on, each `.md` file under a project folder is synced with that project.

- A new line without an ID in any file becomes an SP task, and its ID is written back to that same file.
- Tasks created in SP go to the task file (`backlog.md`) only. Other files only update lines they already hold.
- Deleting a line deletes the SP task, unless the same ID is still in another file, so moving a line between files keeps the task. Clearing a file of its last task works too.
- Removing a file from the folder deletes its tasks in SP. Renaming a file in Obsidian keeps them. Turning the setting off does not delete anything.
- If you change a task's parent in SP, an extra file keeps its old structure.
- Hidden files and symlinks are skipped.

### Links

The **Links** table lists every folder and every SP project and shows how they are joined (linked, folder only, project only, excluded, ambiguous). A **manual bind** overrides the title match, for example when a folder and its project are named differently. A name that matches more than one project is never synced automatically.

## Task file format

```markdown
- [ ] <!--task-id--> Parent task
  - [x] <!--task-id--> Sub-task @done(2026-10-22 14:30)
    A note line belonging to the sub-task
  A note line belonging to the parent
```

- Two levels only, matching SP: tasks and sub-tasks. Deeper lines become part of the sub-task's note.
- Notes are the lines directly below a task, up to the first blank line.
- Completing a task in SP appends `@done(YYYY-MM-DD HH:mm)`. Reopening it removes the tag.
- Front matter, headings, blank lines and free text are preserved exactly. Only task lines are rewritten.

The full format reference is in [docs/markdown-format.md](docs/markdown-format.md).

## Manual sync

The **Vault Bridge: Sync Now** button in the SP header forces a full pass. Edits made in the files since the last sync are imported first, so a fresh edit is never overwritten. Then the SP state is written back.

## When something goes missing

If a bound file or project disappears, the plugin pauses that binding and opens a dialog in SP: recreate it, delete the binding, or ignore. In a project file that still contains tasks, a task removed from the file is removed from SP, so the file is the source of truth. See [docs/markdown-format.md](docs/markdown-format.md#what-happens-to-existing-sp-tasks-when-you-create-a-binding) before binding an existing file.

## Development

```bash
npm install
npm test            # jest
npm run build       # bundles plugin.js, index.html, manifest and icon into dist/ and writes vault-bridge-v<version>.zip
```

Source layout and design notes are in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Known limits

- Desktop only. The plugin needs Node execution.
- Vault Bridge relies on a few SP APIs that are not in the public plugin types. They are listed in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#undocumented-sp-apis). A future SP release may change them.

## Credits

- [`sync.md`](https://github.com/johannesjo/super-productivity) plugin for Super Productivity, the original sync design.
- [`sync-md-multi`](https://codeberg.org/fpindado/sync-md-multi) by Fernando Pindado, the multi-binding engine this project is built on. The upstream copyright and MIT license are kept in [LICENSE](LICENSE).

## License

MIT. See [LICENSE](LICENSE).
