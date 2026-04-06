import {
  listWorkspaces,
  listOpenableApps,
  getCoderUrl,
  dashboardUrl,
} from "../lib/coder.ts";

export async function handleApps(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const workspace = url.searchParams.get("workspace");

  if (!workspace) {
    return Response.json({ ok: false, error: "workspace query param is required" }, { status: 400 });
  }

  try {
    const [workspaces, coderUrl] = await Promise.all([
      listWorkspaces(),
      getCoderUrl(),
    ]);

    const ws = workspaces.find((w) => w.name === workspace);
    if (!ws) {
      return Response.json({ ok: false, error: `Workspace "${workspace}" not found` }, { status: 404 });
    }

    const apps = listOpenableApps(ws);
    const dashboard = dashboardUrl(coderUrl, ws.owner_name, ws.name);

    // Build terminal URL from the first agent name
    const agents = ws.latest_build.resources.flatMap((r) => r.agents ?? []);
    const agentName = agents[0]?.name ?? "main";
    const terminal = `${coderUrl}/@${ws.owner_name}/${ws.name}.${agentName}/terminal`;

    return Response.json({
      dashboard,
      terminal,
      apps: apps.map((a) => ({ slug: a.slug, label: a.label })),
    });
  } catch (err: any) {
    return Response.json({ ok: false, error: err.message ?? "Unknown error" }, { status: 500 });
  }
}
