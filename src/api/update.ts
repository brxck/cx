import { updateWorkspace, waitForWorkspace } from "../lib/coder.ts";

export async function handleUpdate(req: Request): Promise<Response> {
  const body = await req.json() as { workspace: string };

  if (!body.workspace) {
    return Response.json({ ok: false, error: "workspace is required" }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (stage: string, message: string) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ stage, message })}\n\n`));
      };

      try {
        send("updating", `Updating ${body.workspace} to latest template version`);
        await updateWorkspace(body.workspace);
        send("waiting", "Waiting for agent to be ready");
        await waitForWorkspace(body.workspace, undefined, (line) => send("log", line));
        send("done", "Workspace updated");
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
