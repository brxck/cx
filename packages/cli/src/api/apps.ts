import {
  listWorkspaces,
  listOpenableApps,
  listTasks,
  taskByWorkspaceId,
  getCoderUrl,
  dashboardUrl,
  taskUrl,
  type CoderTask,
} from "../lib/coder.ts";

export async function handleApps(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const workspace = url.searchParams.get("workspace");

  if (!workspace) {
    return Response.json({ ok: false, error: "workspace query param is required" }, { status: 400 });
  }

  try {
    const [workspaces, coderUrl, tasks] = await Promise.all([
      listWorkspaces(),
      getCoderUrl(),
      listTasks().catch((): CoderTask[] => []),
    ]);

    const ws = workspaces.find((w) => w.name === workspace);
    if (!ws) {
      return Response.json({ ok: false, error: `Workspace "${workspace}" not found` }, { status: 404 });
    }

    const apps = listOpenableApps(ws);
    const dashboard = dashboardUrl(coderUrl, ws.owner_name, ws.name);
    const task = taskByWorkspaceId(tasks).get(ws.id);
    const taskUi = task ? taskUrl(coderUrl, ws.owner_name, task.id) : undefined;

    // Build terminal URL from the first agent name
    const agents = ws.latest_build.resources.flatMap((r) => r.agents ?? []);
    const agentName = agents[0]?.name ?? "main";
    const terminal = `${coderUrl}/@${ws.owner_name}/${ws.name}.${agentName}/terminal`;

    return Response.json({
      dashboard,
      terminal,
      taskUrl: taskUi,
      apps: apps.map((a) => ({
        slug: a.slug,
        label: a.label,
        icon: a.icon?.startsWith("/") ? `${coderUrl}${a.icon}` : a.icon,
      })),
    });
  } catch (err: any) {
    return Response.json({ ok: false, error: err.message ?? "Unknown error" }, { status: 500 });
  }
}
