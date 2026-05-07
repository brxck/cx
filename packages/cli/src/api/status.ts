import {
  listWorkspaces as listCoderWorkspaces,
  workspaceStatus,
  relativeTime,
  getCoderUrl,
  dashboardUrl,
  type CoderWorkspace,
} from "../lib/coder.ts";
import { getAllLayouts, getSessionsForLayout } from "../lib/store.ts";
import type { WorkspaceInfo, LayoutInfo, WorkspaceApp } from "@cx/api-types";

export type { WorkspaceInfo, LayoutInfo };

export async function handleStatus(): Promise<Response> {
  const [coderWorkspaces, layouts, coderUrl] = await Promise.all([
    listCoderWorkspaces().catch((): CoderWorkspace[] => []),
    Promise.resolve(getAllLayouts()),
    getCoderUrl().catch(() => ""),
  ]);

  // Build session lookup from tracked layouts
  const sessionsByCoderWs = new Map<string, string[]>();
  const layoutInfos: LayoutInfo[] = [];
  for (const layout of layouts) {
    const sessions = getSessionsForLayout(layout.name);
    if (sessions.length > 0) {
      const existing = sessionsByCoderWs.get(layout.coder_ws) ?? [];
      existing.push(...sessions);
      sessionsByCoderWs.set(layout.coder_ws, existing);
    }
    layoutInfos.push({
      name: layout.name,
      cmuxId: layout.cmux_id,
      coderWs: layout.coder_ws,
      template: layout.template,
      type: layout.type,
      branch: layout.branch,
      path: layout.path,
      activeAt: layout.active_at,
      sessions,
    });
  }

  const coderHost = coderUrl ? new URL(coderUrl).host : "";
  const workspaces: WorkspaceInfo[] = coderWorkspaces.map((ws) => {
    const dashboard = coderUrl ? dashboardUrl(coderUrl, ws.owner_name, ws.name) : undefined;
    const agents = ws.latest_build.resources.flatMap((r) => r.agents ?? []);
    const agentName = agents[0]?.name ?? "main";
    const terminal = coderUrl
      ? `${coderUrl}/@${ws.owner_name}/${ws.name}.${agentName}/terminal`
      : undefined;
    const apps: WorkspaceApp[] = [];
    for (const agent of agents) {
      for (const app of agent.apps ?? []) {
        if (app.hidden) continue;
        let url: string | undefined;
        if (app.external && app.url) {
          url = app.url;
        } else if (app.subdomain && app.subdomain_name && coderHost) {
          url = `https://${app.subdomain_name}.${coderHost}/`;
        } else if (dashboard) {
          url = `${dashboard}/apps/${app.slug}/`;
        }
        if (url) apps.push({ slug: app.slug, label: app.display_name, url });
      }
    }
    return {
      name: ws.name,
      status: workspaceStatus(ws),
      healthy: ws.health.healthy,
      outdated: ws.outdated,
      buildAge: relativeTime(ws.latest_build.created_at),
      templateName: ws.template_name,
      sessions: sessionsByCoderWs.get(ws.name) ?? [],
      dashboard,
      terminal,
      apps,
    };
  });

  return Response.json({ workspaces, layouts: layoutInfos });
}
