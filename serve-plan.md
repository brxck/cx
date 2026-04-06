# `cx serve` — Mobile Web UI

## Overview

New `cx serve` command that starts an HTTP server with a React SPA for managing workspaces from a phone. All `up` operations are headless (no Cmux layout on mobile). Uses Bun's built-in HTTP server and existing lib functions directly.

## Architecture

```
cx serve --port 3333
    │
    ├── GET  /                  → React SPA (static assets)
    ├── GET  /api/status        → layout + workspace status (JSON, polled)
    ├── GET  /api/templates     → list available templates
    ├── POST /api/up            → headless up (SSE progress stream)
    ├── POST /api/down          → tear down layout (layout name, stop flag)
    └── Static assets           → built React app from src/web/dist/
```

## API Endpoints

| Method | Path | Request Body | Response |
|--------|------|-------------|----------|
| `GET` | `/api/status` | — | `{ layouts: LayoutStatus[], untracked: CoderWorkspace[] }` |
| `GET` | `/api/templates` | — | `{ templates: TemplateConfig[] }` |
| `POST` | `/api/up` | `{ template: string, workspace: string }` | SSE stream (`text/event-stream`) |
| `POST` | `/api/down` | `{ layout: string, stop?: boolean }` | `{ ok: true }` or `{ ok: false, error: string }` |

### SSE Progress Stream for `up`

`POST /api/up` returns `text/event-stream` instead of JSON. Each stage of the workspace creation emits an event:

```
data: {"stage": "creating", "message": "Creating workspace foo"}

data: {"stage": "waiting", "message": "Waiting for agent to be ready"}

data: {"stage": "ssh", "message": "Updating SSH config"}

data: {"stage": "ports", "message": "Port forwarding started: 3000, 8080"}

data: {"stage": "sessions", "message": "Starting 3 ZMX sessions"}

data: {"stage": "done", "layout": "foo", "sessions": 3}
```

On error at any stage:

```
data: {"stage": "error", "message": "Workspace creation failed: quota exceeded"}
```

The stream closes after `done` or `error`. The React client reads this with `fetch()` + `ReadableStream` (not `EventSource`, since it's a POST).

**Why SSE over WebSockets:** The `up` operation is the only thing that benefits from streaming, and it's one-directional (server → client). SSE is simpler — no connection upgrade, no ping/pong, no reconnection logic. Bun supports it natively via `ReadableStream`.

### Implementation: Progress Callback

The `up` API handler creates a `ReadableStream` and passes a `report(stage, message)` callback into the workspace creation logic. Each step calls `report()` which writes an SSE frame to the stream.

```ts
// src/api/up.ts (sketch)
function handleUp(body: { template: string; workspace: string }): Response {
  const stream = new ReadableStream({
    async start(controller) {
      const send = (stage: string, message: string, extra?: object) => {
        controller.enqueue(`data: ${JSON.stringify({ stage, message, ...extra })}\n\n`);
      };

      try {
        send("creating", `Creating workspace ${body.workspace}`);
        await ensureCoderWorkspace(body.workspace, template, send);

        send("ssh", "Updating SSH config");
        await ensureSshConfig();

        // ... ports, sessions ...

        send("done", "Workspace ready", { layout: body.workspace, sessions: n });
      } catch (err) {
        send("error", err.message);
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
  });
}
```

## React SPA Pages

### Status Dashboard (home)
- Card per layout: name, coder status badge, template, git branch, sessions, type
- Card per untracked workspace: name, status, template
- Auto-poll every 10s (simple `setInterval` + `fetch`)
- Pull-to-refresh gesture
- Summary bar at bottom

### Create Workspace
- Template picker (list from `/api/templates`)
- Workspace name input (pre-filled from template name)
- "Create" button → POST `/api/up`
- **Step-by-step progress view** reading SSE stream: each stage appears as a completed step with a spinner on the current one
- Success → navigate to dashboard

### Layout Actions
- Tap layout card → detail view or action sheet
- "Tear Down" with stop/keep toggle → POST `/api/down`

## File Structure

```
src/
  commands/serve.ts          ← cx serve command (Bun.serve + static file serving)
  api/                       ← API route handlers
    status.ts                ← reuses buildLayoutStatuses from status.ts
    templates.ts             ← reuses listTemplatesAsync + getProjectTemplates
    up.ts                    ← headless up with SSE progress stream
    down.ts                  ← down logic (extracted from commands/down.ts)
  web/                       ← React SPA
    index.html
    src/
      main.tsx
      App.tsx
      pages/
        Dashboard.tsx        ← status cards + summary
        CreateWorkspace.tsx  ← template picker + name input + SSE progress
      components/
        LayoutCard.tsx
        WorkspaceCard.tsx
        StatusBadge.tsx
        ProgressSteps.tsx    ← step-by-step progress from SSE stream
      hooks/
        useStatus.ts         ← polling hook for /api/status
        useTemplates.ts
        useUpStream.ts       ← reads SSE stream from POST /api/up
      api.ts                 ← fetch wrappers
    vite.config.ts
    package.json             ← React deps (local to web/)
```

## Key Decisions

1. **Always headless** — `up` from mobile always uses headless mode (ZMX sessions, no Cmux layout). User can `cx attach` from their terminal later.
2. **Same process** — API server and static file serving in one `Bun.serve()` call. No separate frontend dev server in production.
3. **Shared libs** — API handlers import directly from `src/lib/store.ts`, `src/lib/coder.ts`, `src/lib/templates.ts`, etc. No duplication.
4. **Refactor status logic** — Extract `buildLayoutStatuses` and data-gathering from `commands/status.ts` into a shared `src/lib/status.ts` so both CLI and API can use it.
5. **Frontend build** — React app built separately (Vite), output goes to `src/web/dist/`. The `serve` command serves these as static files.
6. **No auth** — single user, accessed over Coder's network.
7. **SSE for `up` only** — Dashboard uses simple polling (10s). Only `up` benefits from streaming since it's a long, multi-stage operation. SSE over WebSocket because it's one-directional and simpler.

## CLI Interface

```
cx serve [--port <number>]
```

- `--port` / `-p` — port to listen on (default: `3333`)
- Prints URL on startup
- Ctrl+C to stop

## Implementation Order

1. Extract status-gathering logic into `src/lib/status.ts`
2. Create API route handlers in `src/api/` (status, templates, down as JSON; up as SSE)
3. Create `src/commands/serve.ts` with `Bun.serve()`
4. Register in `src/cli.ts`
5. Scaffold React app in `src/web/`
6. Build Dashboard page with polling
7. Build CreateWorkspace page with SSE progress
8. Wire up layout actions (down)
9. Add build script for frontend
