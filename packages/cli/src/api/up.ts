import {
  listWorkspaces as listCoderWorkspaces,
  workspaceStatus,
  createWorkspace,
  startWorkspace,
  waitForWorkspace,
  ensureSshConfig,
  buildWorkspaceContext,
  getCoderUrl,
} from "../lib/coder.ts";
import {
  getTemplateSource,
  getProjectTemplateSources,
  prepareTemplate,
  type TemplateConfig,
  type TemplateSource,
} from "../lib/templates.ts";
import { saveLayout, recordSession } from "../lib/store.ts";
import { startHeadlessSessions, startPortForwarding } from "../lib/layout-builder.ts";

export async function handleUp(req: Request): Promise<Response> {
  const body = await req.json() as { template: string; workspace: string; vars?: Record<string, string> };

  if (!body.template || !body.workspace) {
    return Response.json({ ok: false, error: "template and workspace are required" }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (stage: string, message: string, extra?: object) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ stage, message, ...extra })}\n\n`));
      };

      try {
        // 1. Resolve template source
        const source = await resolveSource(body.template);
        if (!source) {
          send("error", `Template "${body.template}" not found`);
          controller.close();
          return;
        }

        // 2. Phase 1 — run fn / substitute vars
        const prepared = await prepareTemplate(source, { cliVars: body.vars });

        // 3. Create/start Coder workspace
        await ensureCoderWorkspace(body.workspace, prepared.coder, send);

        // 4. Phase 2 — finalize layout + ports with live workspace context if needed
        let wsContext;
        if (prepared.needsWorkspace) {
          const ws = (await listCoderWorkspaces()).find((w) => w.name === body.workspace);
          if (!ws) throw new Error(`Workspace "${body.workspace}" missing after ensure`);
          wsContext = buildWorkspaceContext(ws, await getCoderUrl());
        }
        const template = await prepared.finalize({ workspace: wsContext });

        // 5. SSH config
        send("ssh", "Updating SSH config");
        await ensureSshConfig();

        // 6. Port forwarding
        if (template.ports?.length) {
          startPortForwarding(body.workspace, template.ports);
          send("ports", `Port forwarding started: ${template.ports.join(", ")}`);
        }

        // 7. Headless sessions (always headless from mobile)
        send("sessions", "Starting ZMX sessions");
        const sessions = await startHeadlessSessions(template, body.workspace);

        // 8. Save to store
        saveLayout({
          name: body.workspace,
          cmux_id: "headless",
          coder_ws: body.workspace,
          template: template.name,
          type: template.type,
          vars: prepared.resolvedInputs,
        });

        for (const session of sessions) {
          recordSession(body.workspace, session.name, body.workspace);
        }

        send("done", "Workspace ready", { layout: body.workspace, sessions: sessions.length });
      } catch (err: any) {
        send("error", err.message ?? "Unknown error");
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

async function resolveSource(name: string): Promise<TemplateSource | null> {
  const project = await getProjectTemplateSources();
  const local = project?.sources.find((s) => s.name === name);
  if (local) return local;
  return getTemplateSource(name);
}

async function ensureCoderWorkspace(
  name: string,
  coder: TemplateConfig["coder"],
  send: (stage: string, message: string) => void,
): Promise<void> {
  const workspaces = await listCoderWorkspaces();
  const existing = workspaces.find((ws) => ws.name === name);

  const onLog = (line: string) => send("log", line);

  if (!existing) {
    send("creating", `Creating workspace ${name}`);
    await createWorkspace(name, coder.template, {
      params: coder.parameters,
      preset: coder.preset,
    });
    send("waiting", "Waiting for agent to be ready");
    await waitForWorkspace(name, undefined, onLog);
    return;
  }

  const status = workspaceStatus(existing);
  if (status === "running") {
    send("creating", `Workspace ${name} is already running`);
    return;
  }

  if (status === "stopped") {
    send("creating", `Starting workspace ${name}`);
    await startWorkspace(name);
    send("waiting", "Waiting for agent to be ready");
    await waitForWorkspace(name, undefined, onLog);
    return;
  }

  send("waiting", `Workspace is ${status}, waiting for it to be ready`);
  await waitForWorkspace(name, undefined, onLog);
}
