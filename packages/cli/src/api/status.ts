import {
  listWorkspaces as listCoderWorkspaces,
  workspaceStatus,
  relativeTime,
  type CoderWorkspace,
} from "../lib/coder.ts";
import { getAllLayouts, getSessionsForLayout } from "../lib/store.ts";
import type { WorkspaceInfo, LayoutInfo } from "@cx/api-types";

export type { WorkspaceInfo, LayoutInfo };

export async function handleStatus(): Promise<Response> {
  const [coderWorkspaces, layouts] = await Promise.all([
    listCoderWorkspaces().catch((): CoderWorkspace[] => []),
    Promise.resolve(getAllLayouts()),
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

  const workspaces: WorkspaceInfo[] = coderWorkspaces.map((ws) => ({
    name: ws.name,
    status: workspaceStatus(ws),
    healthy: ws.health.healthy,
    outdated: ws.outdated,
    buildAge: relativeTime(ws.latest_build.created_at),
    templateName: ws.template_name,
    sessions: sessionsByCoderWs.get(ws.name) ?? [],
  }));

  return Response.json({ workspaces, layouts: layoutInfos });
}
