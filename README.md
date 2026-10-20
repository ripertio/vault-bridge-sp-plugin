# Obsidian Bridge

A starter Super Productivity plugin for a future Obsidian vault integration.

## Current state

This is only a scaffold: it registers the plugin metadata and loads a minimal
host-side script. It does not access a vault or exchange data yet.

## Plugin files

- `manifest.json` contains the plugin metadata and required manifest fields.
- `plugin.js` is the host-side plugin entry point.

## Development

Edit `manifest.json` and `plugin.js` as the integration takes shape. Keep the
manifest's `hooks` and `permissions` arrays aligned with the plugin's actual
behavior, and request only permissions that are needed.

For the current development and installation workflow, see the
[Super Productivity plugin development guide](https://github.com/super-productivity/super-productivity/blob/master/docs/plugin-development.md).
