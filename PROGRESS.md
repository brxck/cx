# cmux-coder Progress

Tracks implementation status against [DESIGN.md](./DESIGN.md).

## Commands

| Command | Status | Notes |
|---|---|---|
| `up [workspace]` | Done | Resolves template (project-local or global), creates/starts Coder workspace, builds Cmux layout, starts port forwarding, saves to store with path, generates cmux.json |
| `down [layout]` | Done | Closes Cmux workspace, optionally stops Coder workspace (ephemeral defaults to stop, persistent to keep), removes from store, cleans up cmux.json. Auto-detects layout from cwd. |
| `status` | Done | Rich dashboard joining store, Coder, Cmux, sidebar state, and port-forward processes. Per-layout boxes with Coder status, Cmux state, git branch/dirty, path, template, ports, sessions, Claude status, PR info. Untracked workspaces table. Summary line. `--json` and `--layout` flags. |
| `coder list` | Done | Interactive workspace picker with fuzzy filter, SSH and dashboard actions |
| `coder ssh [workspace]` | Done | Session name generation (PNW towns), session history, interactive picker |
| `coder ports [workspace]` | Done | Preset port mappings, interactive multi-select, custom mappings |
| `coder exec <workspace> <cmd>` | Not started | |
| `coder open [workspace]` | Partial | Dashboard open exists in `coder list` action; no standalone command or IDE support yet |
| `coder logs [workspace]` | Not started | |
| `attach [workspace]` | Not started | |
| `detach [layout]` | Not started | |
| `activate [layout]` | Not started | |
| `find <query>` | Not started | |
| `restore` | Not started | |

## Features

| Feature | Status | Notes |
|---|---|---|
| Layout templates (global) | Done | JSON templates at `~/.config/cmux-coder/templates/`, reuses cmux.json layout tree format |
| Per-project templates | Done | `cmux-coder.json` at project/git root with `templates` array, merged with global in picker |
| Path association | Done | `path` column on layouts table (v2 migration), `getLayoutsByPath()`, cwd-based auto-detection in `down` |
| cmux.json generation | Done | Generates Cmux custom commands with SSH + socket forwarding, merges with existing entries |
| Cmux layout orchestration | Done | Recursive layout tree walker: splits -> `new-pane`, surfaces -> `send`/`new-surface` |
| Coder workspace lifecycle | Done | Create, start, stop, wait-for-ready with agent polling |
| SSH config management | Done | Auto-runs `coder config-ssh -y` before layout creation |
| Background port forwarding | Done | Spawns detached `coder port-forward` process from template port config |
| Layout state persistence | Done | SQLite store with layouts and sessions tables |
| Ephemeral vs persistent layout types | Done | Schema, templates, and `down` behavior all wired up |
| Cmux sidebar integration | Done | `sidebarState()` in cmux.ts, parsed for git branch/dirty, PR, Claude status, ports |
| Port-forward detection | Done | Parses `ps aux` for running `coder port-forward` processes |
| Active layout auto port forwarding | Not started | Depends on Cmux focus detection |
| Git branch awareness | Partial | Live git data from Cmux sidebar in `status`; not yet stored/searchable |
| Health monitoring | Not started | |

## Libraries

| Module | Purpose |
|---|---|
| `src/lib/cmux.ts` | Cmux CLI wrapper: workspace/pane/surface CRUD, input, notifications, sidebar state, list-workspaces parsing |
| `src/lib/templates.ts` | Template types, load/save, per-project discovery, cmux.json generation with SSH wrapping |
| `src/lib/store.ts` | SQLite state store — layouts (with path) and sessions, v2 schema |
| `src/lib/coder.ts` | Coder CLI wrapper: list, create, start, stop, wait, SSH, config-ssh, dashboard URLs |
| `src/lib/workspace-picker.ts` | Shared interactive workspace picker with fuzzy matching and status badges |
| `src/lib/session-names.ts` | Generates session names from PNW town names, avoiding duplicates |

## Infrastructure

| Item | Status | Notes |
|---|---|---|
| CLI scaffold (citty) | Done | Root command with subcommands in `src/cli.ts` |
| Build (bun compile) | Done | Standalone binary to `dist/` |
| SQLite state database | Done | `~/.config/cmux-coder/state.db`, v2 schema with `path` column |
| Cmux CLI integration | Done | `src/lib/cmux.ts` wraps all needed cmux commands |
| Template storage (global) | Done | `~/.config/cmux-coder/templates/*.json` |
| Template storage (per-project) | Done | `cmux-coder.json` at project root with `templates` array |
| cmux.json integration | Done | Writes to `~/.config/cmux/cmux.json`, preserves non-generated entries |
