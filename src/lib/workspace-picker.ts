import * as p from "@clack/prompts";
import pc from "picocolors";
import {
  listWorkspaces,
  workspaceStatus,
  relativeTime,
  type CoderWorkspace,
} from "./coder.ts";
import {
  type CmuxWorkspace,
  listWorkspaces as listCmuxWorkspaces,
} from "./cmux.ts";
import { getAllLayouts, type LayoutEntry } from "./store.ts";

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
    `${pc.bold(ws.name)} ${pc.dim(`(${ws.template_name})`)}`,
    statusBadge(ws),
    ...(workspaceStatus(ws) === "running" && !ws.health?.healthy ? [healthBadge(ws)] : []),
    pc.dim(`built ${relativeTime(ws.latest_build.created_at)} ago`),
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

export function formatLayoutLabel(layout: LayoutEntry, cmuxRefs: Set<string>): string {
  const active = cmuxRefs.has(layout.cmux_id);
  const status = active ? pc.green("● active") : pc.dim("○ closed");
  return `${pc.bold(layout.name)}  ${status}  ${pc.dim(layout.coder_ws)}  ${layout.template ? pc.dim(layout.template) + "  " : ""}${pc.dim(layout.type)}`;
}

/**
 * Show an interactive picker for layouts, joined with live Cmux workspace status.
 * Returns the selected layout or null if cancelled.
 */
export async function pickLayout(opts?: {
  layouts?: LayoutEntry[];
  message?: string;
}): Promise<LayoutEntry | null> {
  const layouts = opts?.layouts ?? getAllLayouts();
  if (layouts.length === 0) return null;

  let cmuxWorkspaces: CmuxWorkspace[] = [];
  try {
    cmuxWorkspaces = await listCmuxWorkspaces();
  } catch {}

  const cmuxRefs = new Set(cmuxWorkspaces.map((w) => w.ref));

  // Sort: active first, then by last active time (already sorted from store)
  const sorted = [...layouts].sort((a, b) => {
    const aActive = cmuxRefs.has(a.cmux_id) ? 0 : 1;
    const bActive = cmuxRefs.has(b.cmux_id) ? 0 : 1;
    if (aActive !== bActive) return aActive - bActive;
    return 0; // preserve store ordering (by active_at DESC)
  });

  const choice = await p.select({
    message: opts?.message ?? "Select a layout",
    options: sorted.map((l) => ({
      value: l.name,
      label: formatLayoutLabel(l, cmuxRefs),
    })),
  });

  if (p.isCancel(choice)) return null;

  return sorted.find((l) => l.name === choice) ?? null;
}
