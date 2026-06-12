import { defineCommand } from "citty";
import { consola } from "consola";
import pc from "picocolors";
import { workspaceStatus, relativeTime, requireCoderLogin, type CoderWorkspace } from "../lib/coder.ts";
import { type LayoutStatus, gatherStatus } from "../lib/status.ts";
import type { TaskInfo } from "@cx/api-types";

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

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

/** Second indented line for a task: `↳ <state> · <message>  <uri>`. */
function taskDetailLine(task: TaskInfo): string | null {
  const parts: string[] = [];
  if (task.state) parts.push(task.state);
  if (task.message) parts.push(truncate(task.message, 90));
  let line = parts.join(" · ");
  const uri = task.uri ?? task.prUrl;
  if (uri) {
    const shortUri = uri.replace(/^https?:\/\//, "");
    line = line ? `${line}  ${shortUri}` : shortUri;
  }
  return line ? pc.dim("↳ " + line) : null;
}

function renderLayoutBox(layout: LayoutStatus): void {
  const width = 66;
  const star = layout.coderFavorite ? pc.yellow("★ ") : "";
  const nameTag = star + (layout.cmuxSelected ? pc.bold(pc.cyan(layout.name)) : pc.bold(layout.name));
  const headerPad = width - layout.name.length - (layout.coderFavorite ? 6 : 4);
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

  // Task
  if (layout.task) {
    const t = layout.task;
    const parts = [t.displayName];
    if (t.state) parts.push(pc.dim(t.state));
    lines.push(field("Task", parts.join("  ")));
    const detail = taskDetailLine(t);
    if (detail) lines.push(field("", detail));
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

function renderUntracked(
  workspaces: CoderWorkspace[],
  tasks: Map<string, TaskInfo>,
): void {
  if (workspaces.length === 0) return;
  consola.log("");
  consola.log(pc.dim("Untracked Coder workspaces:"));
  const sorted = [...workspaces].sort(
    (a, b) => (a.favorite ? 0 : 1) - (b.favorite ? 0 : 1),
  );
  for (const ws of sorted) {
    const status = workspaceStatus(ws);
    const badge = ws.favorite ? pc.yellow("★") : statusBadge(status);
    const age = relativeTime(ws.latest_build.created_at);
    const task = tasks.get(ws.id);

    if (task) {
      const visibleLen = `${task.displayName} (${ws.name})`.length;
      const namePad = " ".repeat(Math.max(1, 23 - visibleLen));
      const nameCell = `${task.displayName} ${pc.dim(`(${ws.name})`)}`;
      consola.log(
        `  ${badge}  ${nameCell}${namePad}${status.padEnd(10)} ${pc.dim(ws.template_name.padEnd(16))} ${pc.dim(age + " ago")}`,
      );
      const detail = taskDetailLine(task);
      if (detail) consola.log(`        ${detail}`);
    } else {
      consola.log(
        `  ${badge}  ${ws.name.padEnd(22)} ${status.padEnd(10)} ${pc.dim(ws.template_name.padEnd(16))} ${pc.dim(age + " ago")}`,
      );
    }
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
    await requireCoderLogin();

    const result = await gatherStatus();

    if (!result.cmuxAlive && !args.json) {
      consola.warn("Cmux is not running — sidebar data unavailable");
    }

    // Pinned (Coder favorite) layouts float to the top; otherwise preserve
    // the store's active_at ordering.
    let layoutStatuses = [...result.layouts].sort(
      (a, b) => (a.coderFavorite ? 0 : 1) - (b.coderFavorite ? 0 : 1),
    );

    // Filter to specific layout if requested
    if (args.layout) {
      layoutStatuses = layoutStatuses.filter((l) => l.name === args.layout);
      if (layoutStatuses.length === 0) {
        consola.error(`Layout "${args.layout}" not found`);
        process.exit(1);
      }
    }

    // Render
    if (args.json) {
      console.log(
        JSON.stringify(
          { layouts: layoutStatuses, untracked: result.untracked },
          null,
          2,
        ),
      );
      return;
    }

    if (layoutStatuses.length === 0 && result.untracked.length === 0) {
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
      renderUntracked(result.untracked, result.tasksByWorkspaceId);
      renderSummary(
        layoutStatuses,
        result.coderTotal,
        result.coderRunning,
        result.portForwardCount,
      );
    }
  },
});
