# Working rules for sync-md-multi

- Make small, reviewable commits, with one feature step per commit. Add or update
  focused tests with every feature step.
- After each commit, start a new Claude session for the next feature step, so
  earlier conversation is not re-read on every turn.
- Every new synchronization behavior must be controlled by a user setting that
  defaults to OFF. Provide a dry-run mode that logs intended changes without
  writing files or mutating Super Productivity.
- Never automatically delete Super Productivity tasks or vault content. Any
  deletion requires an explicit setting or a clear confirmation dialog. In
  particular, do not treat a missing task in one Markdown file as proof that the
  task should be deleted from Super Productivity.
- Limit file reads and writes to vault paths explicitly configured by the user.
  Validate resolved paths before every operation; do not broaden filesystem
  access beyond the configured roots.
- Keep console output minimal and prefix plugin messages with `[sync-md]`.
- Preserve the existing license and attribution to `sync.md` / `sync-md-multi`.
  Do not remove or replace upstream copyright, author, or source attribution.
- Use only PluginAPI methods documented by the Super Productivity plugin guide
  and its authoritative API types. Do not add calls based only on runtime
  observations or internal SP APIs.
- Keep the existing bidirectional project/file behavior working unless a
  deliberate, tested behavior change is part of the requested feature.
- Run the focused tests for changed behavior. Do not run `npm run build` or
  `npx tsc --noEmit` yourself; the user runs them. Ask the user to run them
  when a change affects the plugin bundle or TypeScript, and paste back only
  the errors.
- Do not read `package-lock.json`, `dist/`, `node_modules/`, or the
  `sync-md-multi-v0.4.6.zip` archive unless the user asks.
