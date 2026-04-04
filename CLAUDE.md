# cx

CLI for orchestrating Cmux layouts on top of Coder remote dev environments.

## Project docs

- `DESIGN.md` — architecture, command reference, Cmux integration, SSH socket forwarding, template system, state storage
- `PROGRESS.md` — implementation status of all commands, features, and infrastructure

Read these before making changes.

## Stack

- **Runtime**: Bun
- **Arg parsing**: Citty — `defineCommand` / `runMain`
- **Prompts**: @clack/prompts
- **Logging**: consola
- **Colors**: picocolors
- **State**: bun:sqlite at `~/.config/cx/state.db`
- **Build**: `bun build --compile` for standalone binaries

## Project layout

- `src/cli.ts` — main entry, defines root command and subcommands
- `src/commands/*.ts` — one file per subcommand, each exports a `defineCommand`
- `src/lib/store.ts` — SQLite state store (layouts, sessions), schema migrations via `PRAGMA user_version`
- `src/lib/cmux.ts` — Cmux CLI wrapper (workspaces, panes, surfaces, input, notifications)
- `src/lib/templates.ts` — template types, load/save, per-project discovery, cmux.json generation
- `src/lib/coder.ts` — Coder CLI wrapper (list, create, start, stop, wait, SSH, config-ssh)
- `src/lib/workspace-picker.ts` — shared interactive workspace picker
- `src/lib/session-names.ts` — PNW town name generator for SSH sessions
- `bin/cli.ts` — shebang entrypoint

## Scripts

- `bun run dev` — run CLI in dev mode
- `bun run build` — compile standalone binary to `dist/`
- `bun run typecheck` — type-check without emitting

## Terminology

- **Workspace** — a Coder remote dev environment
- **Layout** — a Cmux workspace (renamed to avoid collision with Coder's "workspace")
- **Template** — config that defines a layout: Coder workspace params + Cmux split/pane/surface tree

## Conventions

- Use Bun APIs: `Bun.$` for shell, `Bun.file` for file I/O, `bun:sqlite` for SQLite
- Shell commands via `Bun.$\`cmd\`.quiet()` for captured output, `Bun.spawn()` for interactive/long-running processes
- All store functions are synchronous (bun:sqlite is sync)
- Commands follow the pattern: resolve target (arg or interactive picker) → do work with spinners → save state
- Cmux CLI has no JSON output for `list-workspaces`; we parse text output (see `parseWorkspaceLine` in cmux.ts)
- Templates use the same recursive split tree format as Cmux custom commands (cmux.json)
- Generated cmux.json entries are tagged with `_generator: "cx"` for safe merge/cleanup
