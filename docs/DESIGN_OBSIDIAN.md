# Proposed Obsidian vault sync design

**Status: proposal only. No feature code is implemented by this document.**

The existing plugin is Super Productivity-side code and accesses local Markdown
through `PluginAPI.executeNodeScript()`. This proposal keeps the sync inside
Super Productivity and extends the existing project/file sync model. All new
sync behavior must be opt-in (setting defaults OFF) and support dry-run before
any writes or task mutations.

## Current API findings and unresolved task planning model

The installed `@super-productivity/plugin-api` 1.0.1 `Task` interface in
`node_modules/@super-productivity/plugin-api/dist/types.d.ts` has `id`, `title`,
`notes`, `isDone`, `projectId: string | null`, `tagIds`, `parentId`,
`subTaskIds`, `doneOn`, and `timeSpentOnDay`, among other fields. It does **not**
declare a `plannedFor`, `plannedDate`, or equivalent date field. `timeSpentOnDay`
is recorded effort, not a planning date. `Project` contains task ordering and
backlog fields (`taskIds`, `backlogTaskIds`) but does not define the daily
planning state of an individual task.

The source/tests do not contain a live `PluginAPI.getTasks()` response with
planned and unplanned examples. They contain task mocks and use `tagIds`, but
that is insufficient evidence that a particular tag ID represents "planned for
today". Therefore this design does **not** assume that `TODAY`, a tag, or any
other field is the canonical representation. Before implementation, inspect
sanitized live `getTasks()` results for representative tasks and confirm the
documented SP data model/API for setting and clearing that state.

The installed API types document hooks `taskUpdate`, `taskComplete`,
`taskDelete`, and `action`. The proposed hook plan is:

- `taskUpdate` for task edits and any confirmed planning-field change.
- `taskComplete` and `taskDelete` for completion/deletion notifications, with
  behavior verified on the target SP version.
- `action` only as a narrowly filtered fallback for structural events not
  surfaced by task hooks; use known action names, not substring matching.
- Add only documented hook names to the manifest. Do not rely on the current
  `projectListUpdate`/`anyTaskUpdate` runtime strings unless verified against
  the currently supported guide and types.

Use documented `PluginAPI.getTasks()`, `getAllProjects()`, `addTask()`,
`updateTask()`, `addProject()`, and `registerHook()` methods where needed.
`batchUpdateForProject()` is used by the current code but is absent from the
installed public type declarations; do not build new behavior on it without
verification against current official documentation/types.

## Inbox identification

In the public type model, a task has a nullable `projectId`; an Inbox-specific
field is not defined. Existing tests use the project ID string
`INBOX_PROJECT`, but production code does not currently provide an Inbox
resolver. The initial implementation should identify Inbox by a verified stable
project ID (not a translated/display title), and fail closed if it cannot
identify it. Confirm from live `getAllProjects()` and `getTasks()` output
whether Inbox is represented as a project with that ID or as a null project.

## Proposed configuration and path rules

Extend the existing device-local config in `src/background/local-config.ts`
with an Obsidian root path, a configurable daily-note directory and filename
format, a configurable Inbox backlog path, and a Projects directory. Keep these
settings local to each device because they are absolute filesystem paths.
Maintain stable project-ID-to-relative-folder mappings so project renames do
not silently change identity or accidentally target a different folder.

All paths must resolve beneath the explicitly configured vault root. Normalize
and validate paths before each read/write, reject traversal outside the root,
and account for symlinks when enforcing the boundary. Do not use the existing
general-purpose file browser as authority to access paths outside the configured
vault. The consent required for `nodeExecution` grants broader process
capability; plugin-side path checks remain mandatory.

Resolve daily note paths with a small token replacer (no date-formatting
dependency): replace `YYYY`, `MM`, and `DD` with the local calendar date, then
join the configured vault-relative folder and formatted filename. Validate the
result is inside the vault. Create missing directories/files only as an
explicitly enabled write operation. Ensure the daily task section is exactly
`## To Dos`; if it is absent, add it without replacing other note content.

## Placement and movement rules

Once the canonical SP "planned today" data is confirmed:

1. A task planned for the current local date belongs in that day's note under
   `## To Dos`.
2. An unplanned Inbox task belongs in the configured Inbox backlog Markdown
   file.
3. An unplanned task in an SP project belongs in
   `<ProjectsDir>/<mapped-project-folder>/Backlog.md`.
4. A project folder/backlog file is created only when the user has enabled
   writes; a dry run reports the intended path without creating it.
5. Compute a single canonical destination for every task before synchronizing.
   A task must not be imported as a new task merely because it appears in a
   different managed file.

SP state determines placement in SP-to-Markdown reconciliation. The Markdown
representation carries the existing SP task ID in the existing
`<!--<task-id>-->` comment. Moving a task between today's note and a backlog
retains that same ID. Never mint a replacement task ID to represent a move.

Markdown edits to title, completion state, and supported task notes can be
applied to the identified SP task. Moving a line between managed files is a
location change, but must not change planning state unless the user confirms
that placement itself should mean "plan/unplan today". The source of a planning
change must remain the verified SP field/API; do not infer it from file
location by default.

### Day rollover

At the first sync for a new local date, recompute destinations from current SP
planning state; do not rename or overwrite yesterday's note. Proposed initial
policy: unfinished tasks no longer planned for today move to their Inbox or
project backlog, retaining their ID. Completed tasks remain in the historical
daily note. This completed-task exception is a proposal and requires user
confirmation because it differs from a literal "one location based only on
today's planned state" rule. If the current date changes while the plugin is
open, the next scheduled reconciliation must detect it even without an SP hook.

Replanning a task for today moves its task line from its backlog to the
current daily note while preserving the ID. Replanning away from today moves it
back to the appropriate backlog. Write the destination and confirm it before
removing the old task line; a failure leaves the old copy intact and reports a
duplicate/recovery condition rather than losing the task.

## Inbox and project folders

Use stable SP project IDs for task ownership. Display names are labels, not
identifiers. For project folder creation, map the SP project ID to a safe,
vault-relative directory name; sanitize separators and reserved path segments,
detect collisions, and never overwrite a different project's existing folder.
An already-existing unregistered folder under ProjectsDir is not sufficient
proof to create a new SP project automatically.

The reverse folder-to-project direction is potentially destructive and
ambiguous. Proposed behavior: discover only immediate child folders of the
configured Projects directory; show a dry-run proposal for each unmatched
folder; create an SP project with documented `PluginAPI.addProject()` only
after explicit user approval and only when no matching mapping exists. Once
created, persist the ID-to-folder mapping locally. Project renames and folder
renames require a separate explicit reconciliation decision.

## File parsing, loop prevention, and deletion safety

The current parser/writer operates on one file per project. The new router must
coordinate all managed paths before importing any file. It must not feed one
daily note or backlog file independently into `generateTaskOperations()`,
because that function currently treats tasks missing from that file as delete
candidates for the entire SP project.

Use the existing task ID comments as the identity key across files. Build one
global task-ID inventory from all managed files, reject/report duplicate IDs,
and derive one canonical destination per task. For plugin-originated writes,
record expected content fingerprints per path. Ignore an event only when the
observed content matches the recorded write; do not suppress a real user edit
just because it happened within two seconds. The existing 2-second cooldown is
per sync session, so multi-file routing needs path- and task-aware coordination
across sessions.

Conflict and failure rules:

- Dry-run never writes a file, creates a project, or mutates an SP task; it logs
  each proposed operation with `[sync-md]`.
- Parse errors, duplicate IDs, unknown paths, path-boundary failures, unreadable
  files, and API failures abort the affected reconciliation and preserve the
  source content.
- A task missing from a single file is not a delete request. Missing-file
  events pause that route and ask the user what to do; they never create a
  blank replacement over existing data.
- Unknown task-ID markers are preserved/reported, not stripped or imported as
  replacements without an explicit resolution.
- Never auto-delete an SP task or vault content. Any future delete operation
  needs an explicit setting or confirmation dialog, and must identify the exact
  affected task/file before applying.
- For a move between files, write and verify the destination first; only then
  remove the old managed task line. If either step fails, keep recoverable
  content and report the incomplete move.
- If SP and Markdown changed the same field, do not use file mtime as
  last-writer-wins. Detect the conflict, preserve both inputs, and ask or report
  before choosing a winner.

## Proposed phased implementation plan

1. **Runtime/API discovery (read-only):** confirm SP version, supported
   documented PluginAPI methods and hooks, capture sanitized task/project data
   for planned/unplanned tasks, verify Inbox representation, and agree on
   rollover/conflict policy. No writes.
2. **Safety and settings foundation:** add local vault/path configuration,
   strict path-boundary checks, feature setting default OFF, dry-run default
   ON, and structured dry-run plan output. Test paths and assert no mutations.
3. **Read-only placement planner:** load task/project state and managed files,
   build task-ID inventory and destination plan, detect duplicates/conflicts,
   and report exactly-one-place violations. No file or SP writes.
4. **SP-to-Markdown daily note:** write only tasks verified as planned for the
   current day under `## To Dos`; preserve other note content and IDs.
5. **SP-to-Markdown backlogs:** route Inbox and project tasks to configured
   backlog paths, including safe folder/file creation and cross-file move
   recovery.
6. **Markdown-to-SP non-destructive edits:** sync edits to identified existing
   tasks using documented methods; create new tasks only after an explicit
   create policy is agreed. Missing tasks do not imply deletes.
7. **Project folder discovery:** dry-run unmatched folders first; add explicit
   confirmation before creating SP projects and persist stable mappings.
8. **Rollover and conflict hardening:** add local-day transition handling,
   simultaneous-edit behavior, watcher coordination, and focused integration
   tests. Keep deletion disabled unless separately and explicitly enabled.

Each phase should be a separate small commit, with tests covering its own
behavior. Keep the legacy project/file bindings operable throughout migration.

## Open questions

These need answers or live SP evidence before feature implementation:

1. What does `PluginAPI.getTasks()` return for a task planned for today versus
   an otherwise identical unplanned task in the SP version you use? Which
   documented field/API sets and clears that state? Please provide a sanitized
   sample or confirm the SP version so this can be verified.
2. Is Inbox always exposed in `getAllProjects()` with the stable ID
   `INBOX_PROJECT`, or do Inbox tasks ever have `projectId: null`? The repo's
   tests use `INBOX_PROJECT`, but production code does not establish the
   contract.
3. Should completed tasks remain in the prior day's note as history, or move to
   a backlog at rollover? Should completed tasks ever be removed from notes?
4. Should moving a task line into `## To Dos` in Markdown itself plan it for
   today, or should the line remain in place until the SP planning state is
   changed through its documented API?
5. When a Markdown task is deleted by the user, should it remain in SP (the safe
   default), or may a separate explicit delete setting/dialog delete the SP
   task? What should happen to its ID comment?
6. Should a new project folder create an SP project automatically after the
   feature is enabled, or should each project creation always require
   confirmation? How should folder/project renames be handled?
7. Which exact vault-relative paths and date format should be the defaults for
   the daily directory, Inbox backlog, and Projects directory?
8. Should each daily note's `## To Dos` contain planned tasks from every SP
   project, including Inbox, or only tasks belonging to projects?
