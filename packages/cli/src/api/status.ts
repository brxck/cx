import {
  listWorkspaces as listCoderWorkspaces,
  listTasks,
  taskByWorkspaceId,
  coderTaskToInfo,
  coderAppStatus,
  workspaceStatus,
  relativeTime,
  getCoderUrl,
  dashboardUrl,
  type CoderWorkspace,
  type CoderTask,
} from "../lib/coder.ts";
import { getAllLayouts, getSessionsForLayout } from "../lib/store.ts";
import type { WorkspaceInfo, LayoutInfo, WorkspaceApp, AgentInfo, ResourceMeta } from "@cx/api-types";

export type { WorkspaceInfo, LayoutInfo };

export async function handleStatus(): Promise<Response> {
  const [coderWorkspaces, layouts, coderUrl, tasks] = await Promise.all([
    listCoderWorkspaces().catch((): CoderWorkspace[] => []),
    Promise.resolve(getAllLayouts()),
    getCoderUrl().catch(() => ""),
    listTasks().catch((): CoderTask[] => []),
  ]);

  const taskMap = taskByWorkspaceId(tasks);

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
  const resolveIcon = (icon?: string): string | undefined => {
    if (!icon) return undefined;
    if (icon.startsWith("/") && coderUrl) return `${coderUrl}${icon}`;
    return icon;
  };

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
        if (url) {
          apps.push({
            slug: app.slug,
            label: app.display_name,
            url,
            icon: resolveIcon(app.icon),
          });
        }
      }
    }
    apps.sort((a, b) => a.label.localeCompare(b.label));
    const task = taskMap.get(ws.id);
    const taskUrlCtx = coderUrl ? { baseUrl: coderUrl, ownerName: ws.owner_name } : undefined;

    // Primary agent info
    const primary = agents.find((a) => a.status === "connected") ?? agents[0];
    let agentInfo: AgentInfo | undefined;
    if (primary) {
      const preferredLatency = primary.latency
        ? Object.values(primary.latency).find((r) => r.preferred)?.latency_ms
          ?? Object.values(primary.latency)[0]?.latency_ms
        : undefined;
      const startupMs = primary.started_at && primary.ready_at
        ? new Date(primary.ready_at).getTime() - new Date(primary.started_at).getTime()
        : undefined;
      agentInfo = {
        name: primary.name,
        status: primary.status,
        lifecycleState: primary.lifecycle_state,
        healthReason: primary.health?.reason || undefined,
        arch: primary.architecture || undefined,
        os: primary.operating_system || undefined,
        version: primary.version || undefined,
        latencyMs: preferredLatency,
        startupDurationMs: startupMs && startupMs > 0 ? startupMs : undefined,
        scripts: primary.scripts?.map((s) => ({
          displayName: s.display_name || undefined,
          status: s.status || undefined,
          exitCode: s.exit_code,
        })),
      };
    }

    // Resource metadata (non-sensitive)
    const resourceMeta: ResourceMeta[] = ws.latest_build.resources
      .flatMap((r) => r.metadata ?? [])
      .filter((m) => !m.sensitive && m.value)
      .map((m) => ({ key: m.key, value: m.value }));

    return {
      name: ws.name,
      status: workspaceStatus(ws),
      healthy: ws.health.healthy,
      outdated: ws.outdated,
      favorite: ws.favorite || undefined,
      buildAge: relativeTime(ws.last_used_at || ws.latest_build.created_at),
      lastBuildAt: ws.latest_build.created_at,
      lastUsedAt: ws.last_used_at || undefined,
      templateName: ws.template_name,
      templateDisplayName: ws.template_display_name || undefined,
      templateIcon: resolveIcon(ws.template_icon),
      sessions: sessionsByCoderWs.get(ws.name) ?? [],
      dashboard,
      terminal,
      apps,
      task: task ? coderTaskToInfo(task, taskUrlCtx) : undefined,
      appStatus: coderAppStatus(ws),
      buildReason: ws.latest_build.reason || undefined,
      dailyCost: ws.latest_build.daily_cost || undefined,
      autoStopAt: ws.latest_build.deadline || undefined,
      autostartSchedule: ws.autostart_schedule || undefined,
      automaticUpdates: ws.automatic_updates || undefined,
      dormantAt: ws.dormant_at || undefined,
      deletingAt: ws.deleting_at || undefined,
      agent: agentInfo,
      resourceMeta: resourceMeta.length > 0 ? resourceMeta : undefined,
      queuePosition: ws.latest_build.job?.queue_position || undefined,
      buildError: ws.latest_build.job?.error || undefined,
    };
  });

  workspaces.sort((a, b) => {
    const aTime = new Date(a.lastUsedAt || a.lastBuildAt).getTime();
    const bTime = new Date(b.lastUsedAt || b.lastBuildAt).getTime();
    return bTime - aTime;
  });

  return Response.json({ workspaces, layouts: layoutInfos });
}
