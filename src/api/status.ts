import {
  listWorkspaces as listCoderWorkspaces,
  workspaceStatus,
  relativeTime,
  type CoderWorkspace,
} from "../lib/coder.ts";
import { getAllLayouts, getSessionsForLayout } from "../lib/store.ts";

export interface WorkspaceInfo {
  name: string;
  status: string;
  healthy: boolean;
  outdated: boolean;
  buildAge: string;
  templateName: string;
  sessions: string[];
}

export async function handleStatus(): Promise<Response> {
  const [coderWorkspaces, layouts] = await Promise.all([
    listCoderWorkspaces().catch((): CoderWorkspace[] => []),
    Promise.resolve(getAllLayouts()),
  ]);

  // Build session lookup from tracked layouts
  const sessionsByCoderWs = new Map<string, string[]>();
  for (const layout of layouts) {
    const sessions = getSessionsForLayout(layout.name);
    if (sessions.length > 0) {
      const existing = sessionsByCoderWs.get(layout.coder_ws) ?? [];
      existing.push(...sessions);
      sessionsByCoderWs.set(layout.coder_ws, existing);
    }
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

  return Response.json({ workspaces });
}
