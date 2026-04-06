import { stopWorkspace } from "../lib/coder.ts";
import * as cmux from "../lib/cmux.ts";
import { getLayout, removeLayout } from "../lib/store.ts";

export async function handleDown(req: Request): Promise<Response> {
  const body = await req.json() as { layout: string; stop?: boolean };

  if (!body.layout) {
    return Response.json({ ok: false, error: "layout is required" }, { status: 400 });
  }

  const layout = getLayout(body.layout);
  if (!layout) {
    return Response.json({ ok: false, error: `Layout "${body.layout}" not found` }, { status: 404 });
  }

  try {
    // Close Cmux workspace
    try {
      await cmux.closeWorkspace(layout.cmux_id);
    } catch {
      // Already closed
    }

    // Stop Coder workspace if requested
    if (body.stop) {
      await stopWorkspace(layout.coder_ws);
    }

    // Remove from store
    removeLayout(layout.name);

    return Response.json({ ok: true });
  } catch (err: any) {
    return Response.json({ ok: false, error: err.message ?? "Unknown error" }, { status: 500 });
  }
}
