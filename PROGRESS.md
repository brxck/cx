# cmux-coder Progress

Tracks implementation status against [DESIGN.md](./DESIGN.md).

## Commands

| Command | Status | Notes |
|---|---|---|
| `up [workspace]` | Done | Resolves template (project-local or global), creates/starts Coder workspace, builds Cmux layout, starts port forwarding, saves to store with path, generates cmux.json |
| `down [layout]` | Done | Closes Cmux workspace, optionally stops Coder workspace (ephemeral defaults to stop, persistent to keep), removes from store, cleans up cmux.json. Auto-detects layout from cwd. |
| `attach [workspace]` | Not started | |
| `detach [layout]` | Not started | |
| `activate [layout]` | Not started | |
| `find <query>` | Not started | |
| `status` | Stub | Command exists but not implemented (`src/commands/status.ts`) |
| `list` | Done | Interactive workspace picker with fuzzy filter, SSH and dashboard actions |
| `ssh [workspace]` | Done | Session name generation (PNW towns), session history, interactive picker |
| `ports [workspace]` | Done | Preset port mappings, interactive multi-select, custom mappings |
| `exec <workspace> <cmd>` | Not started | |
| `open [workspace]` | Partial | Dashboard open exists in `list` action; no standalone command or IDE support yet |
| `logs [workspace]` | Not started | |
| `restore` | Not started | |

## Features

| Feature | Status | Notes |
|---|---|---|
| Layout templates (global) | Done | JSON templates at `~/.config/cmux-coder/templates/`, reuses cmux.json layout tree format |
| Per-project templates | In progress | `cmux-coder.json` at project/git root, auto-discovered by `up` |
| Path association | In progress | `path` column on layouts table, enables cwd-based auto-detection in `down`/`find` |
| cmux.json generation | Done | Generates Cmux custom commands with SSH + socket forwarding, merges with existing entries |
| Cmux layout orchestration | Done | Recursive layout tree walker: splits → `new-pane`, surfaces → `send`/`new-surface` |
| Coder workspace lifecycle | Done | Create, start, stop, wait-for-ready with agent polling |
| SSH config management | Done | Auto-runs `coder config-ssh -y` before layout creation |
| Background port forwarding | Done | Spawns detached `coder port-forward` process from template port config |
| Layout state persistence | Done | SQLite store with layouts and sessions tables |
| Ephemeral vs persistent layout types | Done | Schema, templates, and `down` behavior all wired up |
| Active layout auto port forwarding | Not started | Depends on Cmux focus detection |
| Git branch awareness | Not started | Schema supports it (`branch` column on layouts) |
| Health monitoring | Not started | |

## Libraries

| Module | Purpose |
|---|---|
| `src/lib/cmux.ts` | Cmux CLI wrapper: workspace/pane/surface CRUD, input, notifications, list-workspaces parsing |
| `src/lib/templates.ts` | Template types, load/save, per-project discovery, cmux.json generation with SSH wrapping |
| `src/lib/store.ts` | SQLite state store — layouts (with path) and sessions |
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
| Template storage (per-project) | In progress | `cmux-coder.json` at project root |
| cmux.json integration | Done | Writes to `~/.config/cmux/cmux.json`, preserves non-generated entries |
