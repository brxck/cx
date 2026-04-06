import { defineCommand } from "citty";
import { consola } from "consola";
import pc from "picocolors";
import {
  type CoderWorkspace,
  listWorkspaces as listCoderWorkspaces,
  workspaceStatus,
  relativeTime,
} from "../lib/coder.ts";
import {
  type CmuxWorkspace,
  type SidebarState,
  listWorkspaces as listCmuxWorkspaces,
  ping as cmuxPing,
  sidebarState,
  parseSidebarState,
} from "../lib/cmux.ts";
import {
  type LayoutEntry,
  getAllLayouts,
  getSessionsForLayout,
  updateLayout,
} from "../lib/store.ts";
import { detectPortForwardMap } from "../lib/ports.ts";

// ── Types ──

interface LayoutStatus {
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
}

// ── Helpers ──

async function fetchSidebarStates(
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

function buildLayoutStatuses(
  layouts: LayoutEntry[],
  coderWorkspaces: CoderWorkspace[],
  cmuxWorkspaces: CmuxWorkspace[],
  sidebarStates: Map<string, SidebarState>,
  portForwards: Map<string, string[]>,
): LayoutStatus[] {
  const coderByName = new Map(coderWorkspaces.map((w) => [w.name, w]));
  const cmuxByRef = new Map(cmuxWorkspaces.map((w) => [w.ref, w]));

  return layouts.map((layout) => {
    const coder = coderByName.get(layout.coder_ws);
    const cmux = cmuxByRef.get(layout.cmux_id);
    const sidebar = sidebarStates.get(layout.name);
    const sessions = getSessionsForLayout(layout.name);
    const ports = portForwards.get(layout.coder_ws) ?? [];

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
    };
  });
}

// ── Rendering ──

function statusBadge(status: string): string {
  switch (status) {
    case "running":
      return pc.green("●");
    case "stopped":
      return pc.dim("○");
    case "starting":
      return pc.yellow("◐");
    case "stopping":
      return pc.yellow("◑");
    case "failed":
      return pc.red("✖");
    default:
      return pc.dim("?");
  }
}

function claudeBadge(status: string): string {
  switch (status.toLowerCase()) {
    case "running":
      return pc.blue("✳ Running");
    case "idle":
      return pc.dim("⏸ Idle");
    default:
      return pc.dim(status);
  }
}

function shortenHome(p: string): string {
  const home = process.env.HOME ?? "";
  return home && p.startsWith(home) ? "~" + p.slice(home.length) : p;
}

function renderLayoutBox(layout: LayoutStatus): void {
  const width = 66;
  const nameTag = layout.cmuxSelected ? pc.bold(pc.cyan(layout.name)) : pc.bold(layout.name);
  const headerPad = width - layout.name.length - 4;
  const top = pc.dim("┌─ ") + nameTag + " " + pc.dim("─".repeat(Math.max(0, headerPad)) + "┐");
  const bottom = pc.dim("└" + "─".repeat(width - 1) + "┘");

  const lines: string[] = [];

  // Coder
  const coderParts = [statusBadge(layout.coderStatus), layout.coderStatus];
  if (layout.coderTemplateName) coderParts.push(pc.dim(layout.coderTemplateName));
  coderParts.push(pc.dim(`built ${layout.coderBuildAge} ago`));
  if (layout.coderOutdated) coderParts.push(pc.yellow("⚠ outdated"));
  lines.push(field("Coder", coderParts.join("  ")));

  // Cmux
  if (layout.cmuxRef === "headless" && !layout.cmuxActive) {
    lines.push(field("Cmux", pc.yellow("⊘") + "  headless"));
  } else if (layout.cmuxActive) {
    const cmuxParts = [pc.green("●"), "active", pc.dim(layout.cmuxRef)];
    if (layout.cmuxSelected) cmuxParts.push(pc.cyan("[selected]"));
    lines.push(field("Cmux", cmuxParts.join("  ")));
  } else {
    lines.push(field("Cmux", pc.dim("○") + "  closed"));
  }

  // Git
  if (layout.gitBranch) {
    const dirty = layout.gitDirty ? pc.yellow(" (dirty)") : pc.dim(" (clean)");
    lines.push(field("Git", layout.gitBranch + dirty));
  }

  // Path
  if (layout.path) {
    lines.push(field("Path", pc.dim(shortenHome(layout.path))));
  }

  // Template
  if (layout.template) {
    lines.push(field("Template", layout.template + " " + pc.dim(`(${layout.type})`)));
  }

  // Ports
  if (layout.portForwards.length > 0) {
    lines.push(field("Ports", layout.portForwards.join(", ")));
  }

  // Sessions
  if (layout.sessions.length > 0) {
    lines.push(field("Sessions", layout.sessions.join(", ")));
  }

  // Claude
  if (layout.claudeStatus) {
    lines.push(field("Claude", claudeBadge(layout.claudeStatus)));
  }

  // PR
  if (layout.pr) {
    lines.push(field("PR", layout.pr));
  }

  consola.log(top);
  for (const line of lines) {
    consola.log(pc.dim("│") + "  " + line);
  }
  consola.log(bottom);
}

function field(label: string, value: string): string {
  return pc.dim(label.padEnd(10)) + value;
}

function renderUntracked(workspaces: CoderWorkspace[]): void {
  if (workspaces.length === 0) return;
  consola.log("");
  consola.log(pc.dim("Untracked Coder workspaces:"));
  for (const ws of workspaces) {
    const status = workspaceStatus(ws);
    const badge = statusBadge(status);
    const age = relativeTime(ws.latest_build.created_at);
    consola.log(
      `  ${badge}  ${ws.name.padEnd(22)} ${status.padEnd(10)} ${pc.dim(ws.template_name.padEnd(16))} ${pc.dim(age + " ago")}`,
    );
  }
}

function renderSummary(
  layouts: LayoutStatus[],
  coderTotal: number,
  coderRunning: number,
  portForwardCount: number,
): void {
  const active = layouts.filter((l) => l.cmuxActive).length;
  const closed = layouts.length - active;
  consola.log("");
  consola.log(
    pc.dim(
      `${layouts.length} layouts (${active} active, ${closed} closed) · ` +
        `${coderTotal} Coder workspaces (${coderRunning} running) · ` +
        `${portForwardCount} port-forwards`,
    ),
  );
}

// ── Command ──

export const statusCommand = defineCommand({
  meta: {
    name: "status",
    description: "Show status of all layouts and workspaces",
  },
  args: {
    json: { type: "boolean", description: "Output as JSON", default: false },
    layout: { type: "string", description: "Show a specific layout" },
  },
  async run({ args }) {
    // 1. Gather data in parallel
    const cmuxAlive = await cmuxPing();

    const [layouts, coderWorkspaces, cmuxWorkspaces, portForwards] =
      await Promise.all([
        Promise.resolve(getAllLayouts()),
        listCoderWorkspaces().catch((): CoderWorkspace[] => {
          if (!args.json) consola.warn("Could not reach Coder CLI");
          return [];
        }),
        cmuxAlive
          ? listCmuxWorkspaces().catch((): CmuxWorkspace[] => [])
          : Promise.resolve([] as CmuxWorkspace[]),
        detectPortForwardMap(),
      ]);

    if (!cmuxAlive && !args.json) {
      consola.warn("Cmux is not running — sidebar data unavailable");
    }

    // 2. Fetch sidebar states for active layouts
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

    // 3. Build unified statuses
    let layoutStatuses = buildLayoutStatuses(
      layouts,
      coderWorkspaces,
      cmuxWorkspaces,
      sidebarStates,
      portForwards,
    );

    // Filter to specific layout if requested
    if (args.layout) {
      layoutStatuses = layoutStatuses.filter((l) => l.name === args.layout);
      if (layoutStatuses.length === 0) {
        consola.error(`Layout "${args.layout}" not found`);
        process.exit(1);
      }
    }

    // 4. Find untracked Coder workspaces
    const trackedCoderNames = new Set(layouts.map((l) => l.coder_ws));
    const untrackedCoder = coderWorkspaces.filter(
      (ws) => !trackedCoderNames.has(ws.name),
    );

    // 5. Render
    if (args.json) {
      console.log(
        JSON.stringify(
          { layouts: layoutStatuses, untracked: untrackedCoder },
          null,
          2,
        ),
      );
      return;
    }

    if (layoutStatuses.length === 0 && untrackedCoder.length === 0) {
      consola.info("No tracked layouts or Coder workspaces found");
      return;
    }

    if (layoutStatuses.length === 0) {
      consola.info("No tracked layouts");
    } else {
      for (const layout of layoutStatuses) {
        renderLayoutBox(layout);
        consola.log("");
      }
    }

    if (!args.layout) {
      renderUntracked(untrackedCoder);

      const coderRunning = coderWorkspaces.filter(
        (w) => workspaceStatus(w) === "running",
      ).length;
      const pfCount = [...portForwards.values()].reduce(
        (sum, p) => sum + p.length,
        0,
      );
      renderSummary(
        layoutStatuses,
        coderWorkspaces.length,
        coderRunning,
        pfCount,
      );
    }
  },
});
