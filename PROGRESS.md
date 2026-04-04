# cmux-coder Progress

Tracks implementation status against [DESIGN.md](./DESIGN.md).

## Commands

| Command | Status | Notes |
|---|---|---|
| `up [layout]` | Not started | Core lifecycle — depends on layout templates and Cmux socket API |
| `down [layout]` | Not started | |
| `attach [workspace]` | Not started | |
| `detach [layout]` | Not started | |
| `activate [layout]` | Not started | Depends on Cmux socket API integration |
| `find <query>` | Not started | Depends on layout state persistence |
| `status` | Stub | Command exists but not implemented (`src/commands/status.ts`) |
| `list` | Done | Interactive workspace picker with fuzzy filter, SSH and dashboard actions |
| `ssh [workspace]` | Done | Session name generation (PNW towns), session history, interactive picker |
| `ports [workspace]` | Done | Preset port mappings, interactive multi-select, custom mappings |
| `exec <workspace> <cmd>` | Not started | |
| `open [workspace]` | Partial | Dashboard open exists in `list` action; no standalone command or IDE support yet |
| `logs [workspace]` | Not started | |
| `templates list` | Not started | |
| `templates create` | Not started | |
| `templates edit <name>` | Not started | |
| `restore` | Not started | Depends on layout state persistence |

## Features

| Feature | Status | Notes |
|---|---|---|
| Declarative layout templates | Not started | Template schema, storage location, and parsing TBD |
| Active layout auto port forwarding | Not started | Depends on Cmux socket API for focus detection |
| Layout state persistence | Done | SQLite store with layouts, sessions, ports tables |
| Git branch awareness | Not started | Schema supports it (`branch` column on layouts) |
| Workspace lifecycle hooks | Not started | |
| Health monitoring | Not started | |
| Ephemeral vs persistent layout types | Not started | Schema supports it (`type` column on layouts) |

## Libraries

| Module | Purpose |
|---|---|
| `src/lib/store.ts` | SQLite state store — layouts, sessions, ports. Unified replacement for old JSON stores |
| `src/lib/coder.ts` | Coder API: list workspaces, status parsing, SSH, browser open, dashboard URLs |
| `src/lib/workspace-picker.ts` | Shared interactive workspace picker with fuzzy matching and status badges |
| `src/lib/session-names.ts` | Generates session names from PNW town names, avoiding duplicates |

## Infrastructure

| Item | Status | Notes |
|---|---|---|
| CLI scaffold (citty) | Done | Root command with subcommands in `src/cli.ts` |
| Build (bun compile) | Done | Standalone binary to `dist/` |
| SQLite state database | Done | `~/.config/cmux-coder/state.db`, migrated via `PRAGMA user_version` |
| Cmux socket API integration | Not started | Required for layout orchestration, activate, find |
| Layout template storage | Not started | Likely `~/.config/cmux-coder/templates/` or project-local |
