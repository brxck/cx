import * as p from "@clack/prompts";
import pc from "picocolors";
import {
  workspaceStatus,
  relativeTime,
  isStaleStoppedWorkspace,
  type CoderWorkspace,
} from "./coder.ts";
import {
  type CmuxWorkspace,
  listWorkspaces as listCmuxWorkspaces,
} from "./cmux.ts";
import { getAllLayouts, type LayoutEntry } from "./store.ts";
import { loadWorkspaces } from "./workspace-cache.ts";

export const REFRESH_SENTINEL = "__cx_refresh__";
export const SHOW_ALL_SENTINEL = "__cx_show_all__";

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

function sortWorkspaces(list: CoderWorkspace[]): CoderWorkspace[] {
  return [...list].sort((a, b) => {
    const aRunning = workspaceStatus(a) === "running" ? 0 : 1;
    const bRunning = workspaceStatus(b) === "running" ? 0 : 1;
    if (aRunning !== bRunning) return aRunning - bRunning;
    return a.name.localeCompare(b.name);
  });
}

function applyFilter(list: CoderWorkspace[], filter?: string): CoderWorkspace[] {
  if (!filter) return list;
  return list.filter((ws) => fuzzyMatch(filter, ws.name));
}

interface PickerOpts {
  filter?: string;
  message?: string;
  showStopped?: boolean;
}

/**
 * Run the picker against an already-resolved workspace list. Used for re-prompt
 * paths (sentinel refresh, removed pick) where SWR has already settled.
 */
export async function pickWorkspaceFromList(
  list: CoderWorkspace[],
  opts?: PickerOpts,
): Promise<CoderWorkspace | null> {
  const filtered = applyFilter(list, opts?.filter);
  if (filtered.length === 0) return null;
  if (opts?.filter) {
    const exact = filtered.find((ws) => ws.name === opts.filter);
    if (exact) return exact;
  }

  const showStopped = opts?.showStopped ?? false;

  const selected = await p.autocomplete({
    message: opts?.message ?? "Select a workspace",
    options: () => buildPickerOptions(filtered, showStopped),
    placeholder: "Type to filter",
  });

  if (p.isCancel(selected)) return null;
  if (selected === REFRESH_SENTINEL) {
    return pickWorkspaceFromList(list, opts);
  }
  if (selected === SHOW_ALL_SENTINEL) {
    return pickWorkspaceFromList(list, { ...opts, showStopped: true });
  }
  return list.find((w) => w.name === selected) ?? null;
}

function buildPickerOptions(
  list: CoderWorkspace[],
  showStopped: boolean,
): { value: string; label: string }[] {
  let visible = list;
  let hasHidden = false;

  if (!showStopped) {
    const active = list.filter((ws) => {
      const s = workspaceStatus(ws);
      if (s === "failed") return false;
      if (s === "stopped") return !isStaleStoppedWorkspace(ws);
      return true;
    });
    if (active.length > 0) {
      visible = active;
      hasHidden = active.length < list.length;
    }
  }

  const rows = sortWorkspaces(visible).map((ws) => ({
    value: ws.name,
    label: formatWorkspaceLabel(ws),
  }));
  if (hasHidden) {
    rows.push({ value: SHOW_ALL_SENTINEL, label: pc.dim("↻ Show stopped workspaces") });
  }
  rows.push({ value: REFRESH_SENTINEL, label: pc.dim("↻ Refresh list") });
  return rows;
}

/**
 * Fetch workspaces, optionally filter, and present an interactive picker.
 * Returns the selected workspace or null if cancelled.
 * If `filter` is provided, narrows the list before presenting.
 *
 * Uses stale-while-revalidate: renders against cached data instantly when
 * available, refreshes in the background, and reconciles the picked workspace
 * against the fresh result before returning.
 */
export async function pickWorkspace(opts?: PickerOpts): Promise<CoderWorkspace | null> {
  const { cached, fresh } = loadWorkspaces();

  let usedCache = false;
  let latest: CoderWorkspace[];

  if (cached && cached.workspaces.length > 0) {
    latest = cached.workspaces;
    usedCache = true;
    fresh.then((list) => { latest = list; }).catch(() => {});
  } else {
    const spinner = p.spinner();
    spinner.start("Fetching workspaces");
    try {
      latest = await fresh;
    } catch {
      spinner.stop("Failed to fetch workspaces");
      return null;
    }
    spinner.stop(`Found ${latest.length} workspace${latest.length === 1 ? "" : "s"}`);
  }

  if (latest.length === 0) return null;

  if (opts?.filter) {
    const exact = latest.find((ws) => ws.name === opts.filter);
    if (exact) {
      try {
        const freshList = await fresh;
        return freshList.find((w) => w.name === opts.filter) ?? exact;
      } catch {
        return exact;
      }
    }
  }

  const showStopped = opts?.showStopped ?? false;
  const baseMessage = opts?.message ?? "Select a workspace";
  const message = usedCache
    ? `${baseMessage} ${pc.dim("• refreshing…")}`
    : baseMessage;

  const selected = await p.autocomplete({
    message,
    options: () => buildPickerOptions(applyFilter(latest, opts?.filter), showStopped),
    placeholder: "Type to filter",
  });

  if (p.isCancel(selected)) return null;

  if (selected === SHOW_ALL_SENTINEL) {
    let live: CoderWorkspace[];
    try {
      live = await fresh;
    } catch {
      live = latest;
    }
    return pickWorkspaceFromList(live, { ...opts, showStopped: true });
  }

  if (selected === REFRESH_SENTINEL) {
    let live: CoderWorkspace[];
    try {
      live = await fresh;
    } catch {
      return null;
    }
    return pickWorkspaceFromList(live, opts);
  }

  let freshList: CoderWorkspace[];
  try {
    freshList = await fresh;
  } catch {
    return latest.find((w) => w.name === selected) ?? null;
  }

  const freshPicked = freshList.find((w) => w.name === selected);
  if (freshPicked) return freshPicked;

  p.log.warn(`Workspace ${pc.bold(selected)} no longer exists. Re-listing…`);
  return pickWorkspaceFromList(freshList, opts);
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

  const choice = await p.autocomplete({
    message: opts?.message ?? "Select a layout",
    options: sorted.map((l) => ({
      value: l.name,
      label: formatLayoutLabel(l, cmuxRefs),
    })),
    placeholder: "Type to filter",
  });

  if (p.isCancel(choice)) return null;

  return sorted.find((l) => l.name === choice) ?? null;
}
