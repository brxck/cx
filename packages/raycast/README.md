# cx for Raycast

Reach Cmux layouts and Coder workspaces from Raycast (`⌘-Space`).

## Requirements

- [`cx`](../cx) installed and in `$PATH`
- `cx serve` running on `localhost:7373` (override host/port in extension preferences)

Start the server in a terminal:

```sh
cx serve
```

Or auto-start at login with launchd — see `cx`'s `DESIGN.md`.

## Commands

| Command | Mode | Notes |
|---|---|---|
| **List Layouts** | `view` | Browse Cmux layouts with branch/session/status. ⏎ to activate. |
| **List Workspaces** | `view` | Coder workspaces — start, stop, restart, update, dashboard. |
| **Workspace Status** | `menu-bar` | Running-workspace count in the menu bar; refreshes every 5 minutes. |
| **Up From Template** | `view` | Form: pick template, name workspace, optional vars JSON. Streams /api/up. |
| **Find Layout** | `no-view` | Single-arg fuzzy match → activate. Bind a hotkey for one-keystroke switching. |

## Local development

```sh
npm install
npx ray develop
```

Drop a 512×512 PNG at `assets/icon.png` before publishing — Raycast falls back to a generic icon during local dev if missing.

Raycast hot-reloads on save. Stop `cx serve` to confirm the friendly empty state.

## Architecture

Hits the cx HTTP API directly — no shell, no SQLite. Endpoints consumed:

- `GET /api/status` — layouts + workspaces
- `GET /api/templates`
- `POST /api/activate` `{ layout }`
- `POST /api/down` `{ layout, stop? }`
- `POST /api/start` `{ workspace }`
- `POST /api/stop` `{ workspace }`
- `POST /api/restart` `{ workspace }` (SSE)
- `POST /api/update` `{ workspace }` (SSE)
- `POST /api/up` `{ template, workspace, vars? }` (SSE)
- `GET /api/apps?workspace=…`
