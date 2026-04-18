# cx

CLI for orchestrating [Cmux](https://cmux.com) layouts on top of [Coder](https://coder.com) remote dev environments.

cx bridges the gap between Coder workspaces (remote dev environments) and Cmux (a terminal workspace manager). It generates Cmux custom commands that SSH into Coder workspaces with the right pane layout, port forwarding, and ZMX session management — so your remote workspaces feel like local ones.

## Install

**From GitHub Releases** (macOS & Linux):

```bash
curl -fsSL https://raw.githubusercontent.com/brxck/cx/main/install.sh | bash
```

**From source** (requires [Bun](https://bun.sh)):

```bash
git clone git@github.com:brxck/cx.git
cd cx
bun install
bun link
```

## Prerequisites

- [Cmux](https://cmux.com) — terminal workspace manager
- [Coder CLI](https://coder.com/docs/cli) — authenticated and configured
- [ZMX](https://github.com/neurosnap/zmx) — on your remote workspaces, for persistent sessions

## Commands

```
cx
├── up [layout]         Create a workspace and build a Cmux layout
├── down [layout]       Tear down a layout, optionally stop the workspace
├── attach [workspace]  Attach an existing workspace to a new layout
├── detach [layout]     Remove the layout, keep the workspace running
├── status              Show status of all layouts and workspaces
├── activate [layout]   Switch to a layout's Cmux workspace
├── find <query>        Search layouts by name, branch, path, or fuzzy query
├── restore             Restore layouts after a restart
├── list                List Coder workspaces
├── ssh [workspace]     SSH into a workspace with session management
├── ports [workspace]   Manage port forwarding (interactive + flags)
├── exec <ws> <cmd>     Run a command on a workspace via SSH
├── open [workspace]    Open a workspace app (dashboard, VS Code, etc.)
├── logs [workspace]    Stream workspace agent logs
└── init                Initialize cx configuration
```

## How it works

1. Define a **template** — Coder workspace config + Cmux layout tree
2. `cx up` creates/starts the Coder workspace
3. cx generates a Cmux custom command that creates the layout with SSH panes, browser surfaces, and port forwarding
4. Each terminal pane gets a named ZMX session, so sessions persist across disconnects

Templates can be defined globally (`~/.config/cx/templates/*.json`) or per-project (`cx.json`).

## Development

```bash
bun install
bun run dev           # run in dev mode
bun run build         # compile standalone binary to dist/
bun run typecheck     # type-check without emitting
```

See [DESIGN.md](DESIGN.md) for architecture details and [PROGRESS.md](PROGRESS.md) for implementation status.
