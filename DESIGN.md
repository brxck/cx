# cmux-coder Design

CLI for orchestrating Cmux layouts on top of Coder remote dev environments.

## Terminology

- **Workspace** — a Coder remote dev environment
- **Layout** — a Cmux workspace (renamed to avoid collision with Coder's "workspace")
- **Template** — a cmux-coder config that generates Cmux custom commands for a Coder workspace

## Command Tree

```
cmux-coder
├── up [layout]              # create workspace + layout from template
├── down [layout]            # teardown layout, optionally stop workspace
├── attach [workspace]       # wrap existing workspace in a layout
├── detach [layout]          # remove layout, keep workspace running
├── activate [layout]        # focus a layout in cmux
├── find <query>             # search layouts by name/branch/template
├── status                   # dashboard of all layouts + workspaces
├── list                     # list workspaces (enhanced)
├── ssh [workspace]          # SSH with session management
├── ports [workspace]        # port forwarding with presets
├── exec <workspace> <cmd>   # run one-off command on workspace
├── open [workspace]         # open dashboard or IDE
├── logs [workspace]         # stream workspace agent logs
└── restore                  # re-establish layouts after restart
```

## Commands

### Core Lifecycle

#### `up [layout]`

Spin up a Coder workspace and Cmux layout from a template. If the workspace already exists and is stopped, start it. Wait for the workspace agent to be ready, then generate and invoke a Cmux custom command that creates the layout with SSH panes, browser surfaces, and port forwarding.

- `--template <name>` — layout template to use
- `--workspace <name>` — override workspace name
- `--no-ports` — skip automatic port forwarding

#### `down [layout]`

Tear down a layout. Interactively confirm whether to also stop the Coder workspace or just remove the Cmux layout. For one-off task workspaces, default to stopping the workspace.

- `--stop` — also stop the Coder workspace (skip confirmation)
- `--keep` — only remove the layout (skip confirmation)

#### `attach [workspace]`

Attach an existing Coder workspace (created outside this tool or from a previous session) into a new Cmux layout. Generates a Cmux custom command for the workspace and invokes it.

- `--template <name>` — layout template to use

#### `detach [layout]`

Remove the Cmux layout but leave the Coder workspace running. Cleans up local session state.

### Navigation & Discovery

#### `activate [layout]`

Focus/switch to a layout in Cmux. If no argument given, interactively pick from active layouts.

#### `find <query>`

Locate layouts by name, git branch checked out in the workspace, or Coder template name. On selection, activate the layout.

- `--branch` — search by git branch name
- `--template` — search by Coder template name

#### `status`

Dashboard view showing all layouts with their workspace state (running/stopped/starting), active sessions, git branch, and health. Non-interactive by default, interactive with `--interactive`.

#### `list`

List Coder workspaces. Enhanced to show layout association (which layouts are connected to which workspaces) and detached state.

### Utilities

#### `ssh [workspace]`

SSH into a workspace with ZMX session management. Existing implementation with session name generation and history.

#### `ports [workspace]`

Port forwarding with preset mappings and interactive selection. Existing implementation.

#### `exec <workspace> <cmd>`

Run a one-off command on a workspace without a full SSH session. Useful for quick checks, running scripts, or automation.

#### `open [workspace]`

Open a workspace in the Coder dashboard, VS Code Remote, or JetBrains Gateway. Interactively pick the target if multiple options available.

#### `logs [workspace]`

Stream workspace agent logs. Useful for debugging workspace startup issues or monitoring agent health.

#### `restore`

Re-establish all layouts after a restart. Reads persisted layout state, starts any stopped workspaces, and re-invokes the Cmux custom commands.

## Cmux Integration

### CLI

The `cmux` CLI is installed locally and provides the full API for controlling layouts. Run `cmux` with no arguments for the complete command reference.

### Hierarchy

```
Window
└── Workspace (our "layout")
    └── Pane (a spatial split region)
        └── Surface (a terminal or browser tab stacked within a pane)
```

### Custom Commands (`cmux.json`)

Reference: https://cmux.com/docs/custom-commands

Cmux natively supports declarative workspace definitions via `cmux.json` files:

- **Per-project**: `./cmux.json` (takes precedence)
- **Global**: `~/.config/cmux/cmux.json`
- Changes are auto-detected, no restart needed
- Commands appear in the Cmux command palette with searchable keywords

A custom command defines a workspace with a recursive split tree layout, terminal surfaces with commands/cwd/env, browser surfaces with URLs, tab colors, and restart behavior (`ignore`/`recreate`/`confirm`).

**cmux-coder generates these.** Rather than building our own layout engine, `up` and `attach` produce Cmux custom commands that SSH into Coder workspaces with the right pane layout. This gives us native Cmux integration — layouts appear in the command palette, respect Cmux's restart behavior, and work with all Cmux features.

### How It Works

1. User defines a cmux-coder template (Coder workspace config + layout preferences)
2. `cmux-coder up` creates/starts the Coder workspace
3. cmux-coder generates a `cmux.json` custom command that:
   - Creates a workspace with the right split layout
   - SSH-es into the Coder workspace in each terminal pane (with `-R` socket forwarding)
   - Opens browser surfaces for web UIs
   - Sets workspace color/name for identification
4. The command is invoked, or the user launches it from the Cmux command palette

### Example Generated Command

For a Coder workspace `my-project` with a fullstack layout:

```json
{
  "commands": [
    {
      "name": "my-project",
      "keywords": ["coder", "fullstack"],
      "restart": "ignore",
      "workspace": {
        "name": "my-project",
        "color": "#3b82f6",
        "layout": {
          "direction": "horizontal",
          "split": 0.6,
          "children": [
            {
              "pane": {
                "surfaces": [
                  {
                    "type": "terminal",
                    "name": "editor",
                    "command": "ssh -R /tmp/cmux.sock:$CMUX_SOCKET_PATH coder.my-project -t 'cd ~/project && nvim'"
                  }
                ]
              }
            },
            {
              "direction": "vertical",
              "split": 0.5,
              "children": [
                {
                  "pane": {
                    "surfaces": [
                      {
                        "type": "terminal",
                        "name": "dev server",
                        "command": "ssh coder.my-project -t 'cd ~/project && make dev'"
                      }
                    ]
                  }
                },
                {
                  "pane": {
                    "surfaces": [
                      {
                        "type": "browser",
                        "name": "preview",
                        "url": "http://localhost:8081"
                      }
                    ]
                  }
                }
              ]
            }
          ]
        }
      }
    }
  ]
}
```

## SSH Configuration

We use `coder config-ssh` to generate standard OpenSSH config entries in `~/.ssh/config`. This means all SSH connections go through real `ssh`, giving us full OpenSSH features including Unix socket forwarding.

This enables **remote Cmux control** — an AI agent running on the remote workspace can send commands back to the local Cmux socket.

### Remote Cmux Socket Forwarding

Terminal surfaces in generated Cmux commands include `-R /tmp/cmux.sock:$CMUX_SOCKET_PATH` to forward the local Cmux socket to the remote. On the remote side, any process writing to `/tmp/cmux.sock` talks to the local Cmux instance.

A remote AI agent can then create panes, send commands, update the status bar, send notifications, and log to the sidebar — turning a remote coding agent into a full local workspace orchestrator.

## State Storage (SQLite)

All local state is stored in a single SQLite database at `~/.config/cmux-coder/state.db`, accessed via `bun:sqlite`. Two tables — `layouts` and `sessions` — with cascade deletes for cleanup. Sessions have a nullable layout FK so `ssh` works standalone. Port forwarding state is not persisted; runtime port state comes from the OS, and desired ports come from layout templates. Schema versioned via `PRAGMA user_version`. All API functions are synchronous.

Implementation: `src/lib/store.ts`

## Key Features

### Active Layout with Auto Port Forwarding

The currently focused Cmux layout is the "active" layout. When a layout becomes active, its configured ports are automatically forwarded. When switching to a different layout, the previous layout's port forwarding can be stopped to free local ports and avoid collisions.

This is opt-in behavior, controlled per-template or globally.

### Layout State Persistence

Layout-to-workspace associations, session names, and template references are persisted locally. This enables:

- `restore` after machine restart
- `status` showing a complete picture without re-scanning
- `find` searching across all known layouts
- Detecting orphaned layouts (layout exists but workspace was deleted)

### Git Branch Awareness

Layouts can be tagged with or auto-detect the git branch checked out in their workspace. This powers `find --branch feat/auth` to quickly locate the layout for a specific feature branch. Branch info is refreshed on `activate` or `status`.

### Health Monitoring

Background process that watches workspace agent health via the Coder API. Notifies via Cmux status bar or system notification when:

- A workspace goes unhealthy
- An SSH connection drops
- A workspace is about to be auto-stopped by Coder's inactivity timeout

### Layout Types

Layouts fall into two categories that affect default behavior:

- **Ephemeral** — one-off task workspaces. `down` defaults to stopping the workspace.
- **Persistent** — long-lived development environments. `down` defaults to detach-only. Sessions are restored on `restore`.

Set per-template or overridden at `up` time.
