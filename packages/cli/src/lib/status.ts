import {
  type CoderWorkspace,
  type CoderTask,
  listWorkspaces as listCoderWorkspaces,
  listTasks,
  taskByWorkspaceId,
  coderTaskToInfo,
  workspaceStatus,
  relativeTime,
} from "./coder.ts";
import type { TaskInfo } from "@cx/api-types";
import {
  type CmuxWorkspace,
  type SidebarState,
  listWorkspaces as listCmuxWorkspaces,
  ping as cmuxPing,
  sidebarState,
  parseSidebarState,
} from "./cmux.ts";
import {
  type LayoutEntry,
  getAllLayouts,
  getSessionsForLayout,
  updateLayout,
} from "./store.ts";
import { detectPortForwardMap } from "./ports.ts";

// ── Types ──

export interface LayoutStatus {
  name: string;
  type: string;
  template: string | null;
  path: string | null;
  createdAt: string;
  lastActiveAt: string;
  coderWorkspace: string;
  coderStatus: string;
  coderHealthy: boolean;
  coderOutdated: boolean;
  coderBuildAge: string;
  coderTemplateName: string | null;
  cmuxRef: string;
  cmuxActive: boolean;
  cmuxSelected: boolean;
  gitBranch: string | null;
  gitDirty: boolean;
  pr: string | null;
  claudeStatus: string | null;
  portForwards: string[];
  sessions: string[];
  task?: TaskInfo;
}

export interface StatusResult {
  layouts: LayoutStatus[];
  untracked: CoderWorkspace[];
  /** Task info keyed by Coder workspace id, for enriching untracked workspaces. */
  tasksByWorkspaceId: Map<string, TaskInfo>;
  coderTotal: number;
  coderRunning: number;
  portForwardCount: number;
  cmuxAlive: boolean;
}

// ── Helpers ──

export async function fetchSidebarStates(
  layouts: LayoutEntry[],
  cmuxWorkspaces: CmuxWorkspace[],
): Promise<Map<string, SidebarState>> {
  const cmuxRefs = new Set(cmuxWorkspaces.map((w) => w.ref));
  const entries = layouts.filter((l) => cmuxRefs.has(l.cmux_id));

  const results = await Promise.all(
    entries.map(async (layout) => {
      try {
        const output = await sidebarState(layout.cmux_id);
        return [layout.name, parseSidebarState(output)] as const;
      } catch {
        return null;
      }
    }),
  );

  const map = new Map<string, SidebarState>();
  for (const entry of results) {
    if (entry) map.set(entry[0], entry[1]);
  }
  return map;
}

export function buildLayoutStatuses(
  layouts: LayoutEntry[],
  coderWorkspaces: CoderWorkspace[],
  cmuxWorkspaces: CmuxWorkspace[],
  sidebarStates: Map<string, SidebarState>,
  portForwards: Map<string, string[]>,
  tasksByWorkspaceId: Map<string, TaskInfo>,
): LayoutStatus[] {
  const coderByName = new Map(coderWorkspaces.map((w) => [w.name, w]));
  const cmuxByRef = new Map(cmuxWorkspaces.map((w) => [w.ref, w]));

  return layouts.map((layout) => {
    const coder = coderByName.get(layout.coder_ws);
    const cmux = cmuxByRef.get(layout.cmux_id);
    const sidebar = sidebarStates.get(layout.name);
    const sessions = getSessionsForLayout(layout.name);
    const ports = portForwards.get(layout.coder_ws) ?? [];
    const task = coder ? tasksByWorkspaceId.get(coder.id) : undefined;

    return {
      name: layout.name,
      type: layout.type,
      template: layout.template,
      path: layout.path,
      createdAt: layout.created_at,
      lastActiveAt: layout.active_at,
      coderWorkspace: layout.coder_ws,
      coderStatus: coder ? workspaceStatus(coder) : "unknown",
      coderHealthy: coder?.health.healthy ?? false,
      coderOutdated: coder?.outdated ?? false,
      coderBuildAge: coder ? relativeTime(coder.latest_build.created_at) : "?",
      coderTemplateName: coder?.template_name ?? null,
      cmuxRef: layout.cmux_id,
      cmuxActive: !!cmux,
      cmuxSelected: cmux?.selected ?? false,
      gitBranch: sidebar?.gitBranch ?? layout.branch,
      gitDirty: sidebar?.gitDirty ?? false,
      pr: sidebar?.pr ?? null,
      claudeStatus: sidebar?.claudeStatus ?? null,
      portForwards: ports,
      sessions,
      task,
    };
  });
}

/** Gather all status data in parallel. Single entry point for CLI and API. */
export async function gatherStatus(): Promise<StatusResult> {
  const cmuxAlive = await cmuxPing();

  const [layouts, coderWorkspaces, cmuxWorkspaces, portForwards, tasks] =
    await Promise.all([
      Promise.resolve(getAllLayouts()),
      listCoderWorkspaces().catch((): CoderWorkspace[] => []),
      cmuxAlive
        ? listCmuxWorkspaces().catch((): CmuxWorkspace[] => [])
        : Promise.resolve([] as CmuxWorkspace[]),
      detectPortForwardMap(),
      listTasks().catch((): CoderTask[] => []),
    ]);

  const tasksByWorkspaceId = new Map<string, TaskInfo>();
  for (const [wsId, task] of taskByWorkspaceId(tasks)) {
    tasksByWorkspaceId.set(wsId, coderTaskToInfo(task));
  }

  const sidebarStates = cmuxAlive
    ? await fetchSidebarStates(layouts, cmuxWorkspaces)
    : new Map<string, SidebarState>();

  // Opportunistically persist branch data from live sidebar
  for (const layout of layouts) {
    const sidebar = sidebarStates.get(layout.name);
    if (sidebar?.gitBranch && sidebar.gitBranch !== layout.branch) {
      try { updateLayout(layout.name, { branch: sidebar.gitBranch }); } catch {}
    }
  }

  const layoutStatuses = buildLayoutStatuses(
    layouts,
    coderWorkspaces,
    cmuxWorkspaces,
    sidebarStates,
    portForwards,
    tasksByWorkspaceId,
  );

  const trackedCoderNames = new Set(layouts.map((l) => l.coder_ws));
  const untracked = coderWorkspaces.filter(
    (ws) => !trackedCoderNames.has(ws.name),
  );

  const coderRunning = coderWorkspaces.filter(
    (w) => workspaceStatus(w) === "running",
  ).length;
  const pfCount = [...portForwards.values()].reduce(
    (sum, p) => sum + p.length,
    0,
  );

  return {
    layouts: layoutStatuses,
    untracked,
    tasksByWorkspaceId,
    coderTotal: coderWorkspaces.length,
    coderRunning,
    portForwardCount: pfCount,
    cmuxAlive,
  };
}
