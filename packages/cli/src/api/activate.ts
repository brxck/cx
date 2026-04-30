import * as cmux from "../lib/cmux.ts";
import { getLayout, touchLayout, updateLayout } from "../lib/store.ts";

export async function handleActivate(req: Request): Promise<Response> {
  const body = await req.json() as { layout: string };

  if (!body.layout) {
    return Response.json({ ok: false, error: "layout is required" }, { status: 400 });
  }

  const layout = getLayout(body.layout);
  if (!layout) {
    return Response.json({ ok: false, error: `Layout "${body.layout}" not found` }, { status: 404 });
  }

  try {
    await cmux.selectWorkspace(layout.cmux_id);
  } catch (err: any) {
    return Response.json(
      { ok: false, error: `Layout "${layout.name}" is not active in Cmux` },
      { status: 409 },
    );
  }

  touchLayout(layout.name);

  try {
    const output = await cmux.sidebarState(layout.cmux_id);
    const sidebar = cmux.parseSidebarState(output);
    if (sidebar.gitBranch) {
      updateLayout(layout.name, { branch: sidebar.gitBranch });
    }
  } catch {}

  return Response.json({ ok: true, layout: layout.name });
}
