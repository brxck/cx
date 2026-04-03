# cmux-coder Design

CLI for orchestrating Cmux layouts on top of Coder remote dev environments.

## Terminology

- **Workspace** — a Coder remote dev environment
- **Layout** — a Cmux workspace (renamed to avoid collision with Coder's "workspace")
- **Template** — a declarative definition of a layout: its tabs, panes, sessions, browser surfaces, and associated Coder workspace config

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
├── templates
│   ├── list                 # show available layout templates
│   ├── create               # capture current layout as a template
│   └── edit <name>          # edit a template definition
└── restore                  # re-establish layouts after restart
```

## Commands

### Core Lifecycle

#### `up [layout]`

Spin up a Coder workspace and Cmux layout from a template. If the workspace already exists and is stopped, start it. Wait for the workspace agent to be ready, then orchestrate the Cmux layout: create tabs, split panes, launch SSH sessions, open browser surfaces, start port forwarding.

- `--template <name>` — layout template to use
- `--workspace <name>` — override workspace name
- `--no-ports` — skip automatic port forwarding

#### `down [layout]`

Tear down a layout. Interactively confirm whether to also stop the Coder workspace or just remove the Cmux layout. For one-off task workspaces, default to stopping the workspace.

- `--stop` — also stop the Coder workspace (skip confirmation)
- `--keep` — only remove the layout (skip confirmation)

#### `attach [workspace]`

Attach an existing Coder workspace (created outside this tool or from a previous session) into a new Cmux layout. Prompts for which layout template to apply, or uses a default.

- `--template <name>` — layout template to use

#### `detach [layout]`

Remove the Cmux layout but leave the Coder workspace running. Cleans up port forwarding and local session state.

### Navigation & Discovery

#### `activate [layout]`

Focus/switch to a layout in Cmux via the socket API. If no argument given, interactively pick from active layouts.

#### `find <query>`

Locate layouts by name, git branch checked out in the workspace, or Coder template name. On selection, activate the layout.

- `--branch` — search by git branch name
- `--template` — search by Coder template name

#### `status`

Dashboard view showing all layouts with their workspace state (running/stopped/starting), forwarded ports, active sessions, git branch, and health. Non-interactive by default, interactive with `--interactive`.

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

### Layout Templates

#### `templates list`

Show available layout templates with a summary of what each creates (number of tabs, panes, ports, etc).

#### `templates create`

Capture the current Cmux layout as a reusable template. Snapshots tab/pane arrangement, session commands, browser surfaces, and port forwarding config.

#### `templates edit <name>`

Open a template definition for editing. Templates are stored as YAML/TOML files.

#### `restore`

Re-establish all layouts after a machine restart. Reads persisted layout state, starts any stopped workspaces, recreates Cmux layouts, and restarts port forwarding.

## Key Features

### Declarative Layout Templates

Templates are the core abstraction. A template file defines everything needed to go from zero to a fully orchestrated dev environment:

```yaml
name: fullstack
coder:
  template: ubuntu-docker    # Coder template to use
  parameters:                # template parameters
    cpu: 4
    memory: 8
layout:
  tabs:
    - name: editor
      panes:
        - ssh: true
          command: "cd ~/project && nvim"
    - name: servers
      panes:
        - ssh: true
          command: "cd ~/project && make dev"
          split: horizontal
        - ssh: true
          command: "cd ~/project && make watch"
    - name: shell
      panes:
        - ssh: true
    - name: browser
      surface: browser
      url: "http://localhost:8080"
ports:
  - 8081:8080   # HTTP
  - 5433:5432   # PostgreSQL
```

`cmux-coder up my-project --template fullstack` reads this definition, creates (or starts) the workspace, waits for readiness, then builds out the entire Cmux layout.

### Active Layout with Auto Port Forwarding

The currently focused Cmux layout is the "active" layout. When a layout becomes active, its configured ports are automatically forwarded. When switching to a different layout, the previous layout's port forwarding can be stopped to free local ports and avoid collisions.

This is opt-in behavior, controlled per-template or globally.

### Layout State Persistence

Layout-to-workspace associations, session names, forwarded ports, and template references are persisted locally. This enables:

- `restore` after machine restart
- `status` showing a complete picture without re-scanning
- `find` searching across all known layouts
- Detecting orphaned layouts (layout exists but workspace was deleted)

### Git Branch Awareness

Layouts can be tagged with or auto-detect the git branch checked out in their workspace. This powers `find --branch feat/auth` to quickly locate the layout for a specific feature branch. Branch info is refreshed on `activate` or `status`.

### Workspace Lifecycle Hooks

Templates can define hooks that run at key moments:

- `post-start` — after workspace is running (e.g., wait for services, seed database)
- `pre-down` — before teardown (e.g., commit WIP, push branch)
- `post-attach` — after attaching to an existing workspace

```yaml
hooks:
  post-start:
    - "cd ~/project && make setup"
  pre-down:
    - "cd ~/project && git stash"
```

### Health Monitoring

Background process that watches workspace agent health via the Coder API. Notifies via Cmux status bar or system notification when:

- A workspace goes unhealthy
- An SSH connection drops
- A workspace is about to be auto-stopped by Coder's inactivity timeout

### Layout Types

Layouts fall into two categories that affect default behavior:

- **Ephemeral** — one-off task workspaces. `down` defaults to stopping the workspace. No port forwarding persistence.
- **Persistent** — long-lived development environments. `down` defaults to detach-only. Ports and sessions are restored on `restore`.

Set per-template or overridden at `up` time.
