import * as p from "@clack/prompts";
import pc from "picocolors";
import {
  listWorkspaces,
  workspaceStatus,
  relativeTime,
  type CoderWorkspace,
} from "./coder.ts";

function statusBadge(ws: CoderWorkspace): string {
  const s = workspaceStatus(ws);
  switch (s) {
    case "running":
      return pc.green("● running");
    case "stopped":
      return pc.dim("○ stopped");
    case "starting":
      return pc.yellow("◐ starting");
    case "stopping":
      return pc.yellow("◑ stopping");
    case "failed":
      return pc.red("✖ failed");
    default:
      return pc.dim(`? ${s}`);
  }
}

function healthBadge(ws: CoderWorkspace): string {
  return ws.health?.healthy ? pc.green("healthy") : pc.red("unhealthy");
}

export function formatWorkspaceLabel(ws: CoderWorkspace): string {
  const parts = [
    pc.bold(ws.latest_build.template_version_name),
    statusBadge(ws),
    healthBadge(ws),
    pc.dim(`built ${relativeTime(ws.latest_build.created_at)} ago`),
    pc.dim(ws.name),
  ];
  return parts.join("  ");
}

export function fuzzyMatch(query: string, target: string): boolean {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  return qi === q.length;
}

/**
 * Fetch workspaces, optionally filter, and present an interactive picker.
 * Returns the selected workspace or null if cancelled.
 * If `filter` is provided, narrows the list before presenting.
 */
export async function pickWorkspace(opts?: {
  filter?: string;
  message?: string;
}): Promise<CoderWorkspace | null> {
  const spinner = p.spinner();
  spinner.start("Fetching workspaces");

  let workspaces: CoderWorkspace[];
  try {
    workspaces = await listWorkspaces();
  } catch {
    spinner.stop("Failed to fetch workspaces");
    return null;
  }

  spinner.stop(`Found ${workspaces.length} workspace${workspaces.length === 1 ? "" : "s"}`);

  if (workspaces.length === 0) return null;

  let filtered = workspaces;
  if (opts?.filter) {
    filtered = workspaces.filter((ws) => fuzzyMatch(opts.filter!, ws.name));
    if (filtered.length === 0) return null;
  }

  // Sort: running first, then alphabetical
  filtered.sort((a, b) => {
    const aRunning = workspaceStatus(a) === "running" ? 0 : 1;
    const bRunning = workspaceStatus(b) === "running" ? 0 : 1;
    if (aRunning !== bRunning) return aRunning - bRunning;
    return a.name.localeCompare(b.name);
  });

  // Single match — return directly
  if (filtered.length === 1) return filtered[0]!;

  const selected = await p.select({
    message: opts?.message ?? "Select a workspace",
    options: filtered.map((ws) => ({
      value: ws.name,
      label: formatWorkspaceLabel(ws),
    })),
  });

  if (p.isCancel(selected)) return null;

  return filtered.find((w) => w.name === selected) ?? null;
}
