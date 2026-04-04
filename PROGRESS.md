# cmux-coder Progress

Tracks implementation status against [DESIGN.md](./DESIGN.md).

## Commands

| Command | Status | Notes |
|---|---|---|
| `up [workspace]` | Done | Resolves template (project-local or global), creates/starts Coder workspace, builds Cmux layout, starts port forwarding, saves to store with path, generates cmux.json. `--headless`/`-H` starts ZMX sessions without a Cmux layout. |
| `down [layout]` | Done | Closes Cmux workspace, optionally stops Coder workspace (ephemeral defaults to stop, persistent to keep), removes from store, cleans up cmux.json. Auto-detects layout from cwd. |
| `status` | Done | Rich dashboard joining store, Coder, Cmux, sidebar state, and port-forward processes. Per-layout boxes with Coder status, Cmux state (headless shown as `⊘ headless`), git branch/dirty, path, template, ports, sessions, Claude status, PR info. Untracked workspaces table. Summary line. `--json` and `--layout` flags. |
| `coder list` | Done | Interactive workspace picker with fuzzy filter, SSH and dashboard actions |
| `coder ssh [workspace]` | Done | Session name generation (PNW towns), session history, interactive picker |
| `coder ports [workspace]` | Done | Preset port mappings, interactive multi-select, custom mappings |
| `coder exec <workspace> <cmd>` | Done | Runs command via SSH with `--` separator, checks workspace is running |
| `coder open [workspace]` | Done | Dashboard (browser) and VS Code targets, interactive picker or `--target` flag |
| `coder logs [workspace]` | Done | Streams agent logs with `--follow` (default) and `--build` number |
| `attach [workspace]` | Done | Picks running Coder workspace, resolves template (or default single-pane), builds Cmux layout, saves to store. Detects headless layouts and re-attaches using stored ZMX session names. |
| `detach [layout]` | Done | Closes Cmux workspace, removes from store and cmux.json, keeps Coder workspace running. Auto-detects from cwd. |
| `activate [layout]` | Done | Exact name, fuzzy match, or interactive picker. Switches Cmux workspace and touches store. |
| `find <query>` | Done | Fuzzy search across name/coder_ws/template/branch/path, `--branch` with live sidebar state, `--path` flag. Activates on selection. |
| `restore` | Not started | |

## Features

| Feature | Status | Notes |
|---|---|---|
| Layout templates (global) | Done | JSON templates at `~/.config/cmux-coder/templates/`, reuses cmux.json layout tree format |
| Per-project templates | Done | `cmux-coder.json` at project/git root with `templates` array, merged with global in picker |
| Path association | Done | `path` column on layouts table (v2 migration), `getLayoutsByPath()`, cwd-based auto-detection in `down` |
| cmux.json generation | Done | Generates Cmux custom commands with SSH + socket forwarding, merges with existing entries |
| Cmux layout orchestration | Done | Recursive layout tree walker: splits -> `new-pane`, surfaces -> `send`/`new-surface`. Always assigns named ZMX sessions to terminal surfaces. |
| Coder workspace lifecycle | Done | Create, start, stop, wait-for-ready with agent polling |
| SSH config management | Done | Auto-runs `coder config-ssh -y` before layout creation |
| Background port forwarding | Done | Spawns detached `coder port-forward` process from template port config |
| Layout state persistence | Done | SQLite store with layouts and sessions tables |
| Ephemeral vs persistent layout types | Done | Schema, templates, and `down` behavior all wired up |
| Cmux sidebar integration | Done | `sidebarState()` in cmux.ts, parsed for git branch/dirty, PR, Claude status, ports |
| Port-forward detection | Done | Parses `ps aux` for running `coder port-forward` processes |
| Headless mode | Done | `up --headless` starts ZMX sessions without Cmux layout; `attach` re-connects to headless sessions; `status` shows `⊘ headless` badge |
| ZMX session tracking | Done | All terminal surfaces get named ZMX sessions, recorded in store, reconnectable across layout rebuilds |
| Active layout auto port forwarding | Not started | Depends on Cmux focus detection |
| Git branch awareness | Partial | Live git data from Cmux sidebar in `status`; not yet stored/searchable |
| Health monitoring | Not started | |

## Libraries

| Module | Purpose |
|---|---|
| `src/lib/cmux.ts` | Cmux CLI wrapper: workspace/pane/surface CRUD, input, notifications, sidebar state with `SidebarState`/`parseSidebarState`, list-workspaces parsing |
| `src/lib/templates.ts` | Template types, load/save, per-project discovery, cmux.json generation with SSH wrapping |
| `src/lib/store.ts` | SQLite state store — layouts (with path) and sessions, v2 schema |
| `src/lib/layout-builder.ts` | Shared layout building: `buildCmuxLayout()` (tree walker + Cmux workspace creation, returns sessions), `startHeadlessSessions()`, `collectTerminalSurfaces()`, `assignSessionNames()`, `startPortForwarding()` |
| `src/lib/coder.ts` | Coder CLI wrapper: list, create, start, stop, wait, SSH, config-ssh, dashboard URLs, exec, VS Code open, log streaming |
| `src/lib/workspace-picker.ts` | Shared interactive Coder workspace picker and layout picker (`pickLayout`) with fuzzy matching and status badges |
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
