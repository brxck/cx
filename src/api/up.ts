import {
  listWorkspaces as listCoderWorkspaces,
  workspaceStatus,
  createWorkspace,
  startWorkspace,
  waitForWorkspace,
  ensureSshConfig,
} from "../lib/coder.ts";
import { getTemplate, getProjectTemplates, type TemplateConfig } from "../lib/templates.ts";
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
        // 1. Resolve template
        const template = await resolveTemplate(body.template);
        if (!template) {
          send("error", `Template "${body.template}" not found`);
          controller.close();
          return;
        }

        // 2. Create/start Coder workspace
        send("creating", `Creating workspace ${body.workspace}`);
        await ensureCoderWorkspace(body.workspace, template, send);

        // 3. SSH config
        send("ssh", "Updating SSH config");
        await ensureSshConfig();

        // 4. Port forwarding
        if (template.ports?.length) {
          startPortForwarding(body.workspace, template.ports);
          send("ports", `Port forwarding started: ${template.ports.join(", ")}`);
        }

        // 5. Headless sessions (always headless from mobile)
        send("sessions", "Starting ZMX sessions");
        const sessions = await startHeadlessSessions(template, body.workspace);

        // 6. Save to store
        saveLayout({
          name: body.workspace,
          cmux_id: "headless",
          coder_ws: body.workspace,
          template: template.name,
          type: template.type,
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

async function resolveTemplate(name: string): Promise<TemplateConfig | null> {
  // Check project-local first, then global
  const project = await getProjectTemplates();
  const local = project?.templates.find((t) => t.name === name);
  if (local) return local;
  return getTemplate(name);
}

async function ensureCoderWorkspace(
  name: string,
  template: TemplateConfig,
  send: (stage: string, message: string) => void,
): Promise<void> {
  const workspaces = await listCoderWorkspaces();
  const existing = workspaces.find((ws) => ws.name === name);

  if (!existing) {
    send("creating", `Creating workspace ${name}`);
    await createWorkspace(name, template.coder.template, {
      params: template.coder.parameters,
      preset: template.coder.preset,
    });
    send("waiting", "Waiting for agent to be ready");
    await waitForWorkspace(name);
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
    await waitForWorkspace(name);
    return;
  }

  send("waiting", `Workspace is ${status}, waiting for it to be ready`);
  await waitForWorkspace(name);
}
