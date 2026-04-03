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
| `list` | Done | Interactive workspace picker with fuzzy filter, SSH and dashboard actions (`src/commands/list.ts`) |
| `ssh [workspace]` | Done | Session name generation (PNW towns), session history, interactive picker (`src/commands/ssh.ts`) |
| `ports [workspace]` | Done | Preset port mappings, interactive multi-select, custom mappings (`src/commands/port-forward.ts`) |
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
| Layout state persistence | Not started | Need to define what gets persisted and where |
| Git branch awareness | Not started | |
| Workspace lifecycle hooks | Not started | |
| Health monitoring | Not started | |
| Ephemeral vs persistent layout types | Not started | |

## Libraries Built

| Module | Purpose |
|---|---|
| `src/lib/coder.ts` | Coder API: list workspaces, status parsing, SSH, browser open, dashboard URLs |
| `src/lib/workspace-picker.ts` | Shared interactive workspace picker with fuzzy matching and status badges |
| `src/lib/session-store.ts` | Persists session name history per workspace to `~/.config/cmux-coder/sessions.json` |
| `src/lib/session-names.ts` | Generates session names from PNW town names, avoiding duplicates |

## Infrastructure

| Item | Status | Notes |
|---|---|---|
| CLI scaffold (citty) | Done | Root command with subcommands in `src/cli.ts` |
| Build (bun compile) | Done | Standalone binary to `dist/` |
| Config directory | Done | `~/.config/cmux-coder/` used by session store |
| Cmux socket API integration | Not started | Required for layout orchestration, activate, find |
| Layout template storage | Not started | Likely `~/.config/cmux-coder/templates/` or project-local |
| Layout state store | Not started | Likely `~/.config/cmux-coder/state.json` or similar |
