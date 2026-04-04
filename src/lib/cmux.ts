import { $ } from "bun";

// ── Types ──

export interface CmuxWorkspace {
  ref: string;
  title: string;
  selected: boolean;
  index: number;
}

export interface CmuxIdentify {
  socket_path: string;
  focused: CmuxSurfaceContext;
  caller: CmuxSurfaceContext;
}

interface CmuxSurfaceContext {
  window_ref: string;
  workspace_ref: string;
  pane_ref: string;
  surface_ref: string;
  tab_ref: string;
  surface_type: "terminal" | "browser";
  is_browser_surface: boolean;
}

// ── Query ──

/** Check if cmux is running and reachable. */
export async function ping(): Promise<boolean> {
  try {
    const result = await $`cmux ping`.quiet();
    return result.text().trim() === "PONG";
  } catch {
    return false;
  }
}

/** List all workspaces. */
export async function listWorkspaces(): Promise<CmuxWorkspace[]> {
  const output = await $`cmux list-workspaces`.quiet().text();
  return output
    .trim()
    .split("\n")
    .filter(Boolean)
    .map(parseWorkspaceLine);
}

/** Get the current workspace UUID. */
export async function currentWorkspace(): Promise<string> {
  return (await $`cmux current-workspace`.quiet().text()).trim();
}

/** Get focused/caller context. */
export async function identify(opts?: {
  workspace?: string;
}): Promise<CmuxIdentify> {
  const args: string[] = [];
  if (opts?.workspace) args.push("--workspace", opts.workspace);
  const result = await $`cmux identify ${args}`.quiet();
  return result.json() as CmuxIdentify;
}

/** Get workspace tree output. */
export async function tree(opts?: { workspace?: string; all?: boolean }): Promise<string> {
  const args: string[] = [];
  if (opts?.workspace) args.push("--workspace", opts.workspace);
  if (opts?.all) args.push("--all");
  return (await $`cmux tree ${args}`.quiet().text()).trim();
}

// ── Create & manage workspaces ──

/** Create a new workspace. Returns the workspace ref (e.g. "workspace:5"). */
export async function newWorkspace(opts?: {
  name?: string;
  cwd?: string;
  command?: string;
}): Promise<string> {
  const args: string[] = [];
  if (opts?.name) args.push("--name", opts.name);
  if (opts?.cwd) args.push("--cwd", opts.cwd);
  if (opts?.command) args.push("--command", opts.command);
  return parseOkRef(await $`cmux new-workspace ${args}`.quiet().text());
}

/** Select (focus) a workspace. */
export async function selectWorkspace(ref: string): Promise<void> {
  await $`cmux select-workspace --workspace ${ref}`.quiet();
}

/** Close a workspace. */
export async function closeWorkspace(ref: string): Promise<void> {
  await $`cmux close-workspace --workspace ${ref}`.quiet();
}

/** Rename a workspace. */
export async function renameWorkspace(ref: string, title: string): Promise<void> {
  await $`cmux rename-workspace --workspace ${ref} ${title}`.quiet();
}

/** Set workspace color via workspace-action. */
export async function setWorkspaceColor(ref: string, color: string): Promise<void> {
  await $`cmux workspace-action --action set --workspace ${ref} --color ${color}`.quiet();
}

// ── Panes & surfaces ──

/** Create a new pane. Returns the pane ref (e.g. "pane:3"). */
export async function newPane(opts?: {
  workspace?: string;
  direction?: "left" | "right" | "up" | "down";
  type?: "terminal" | "browser";
  url?: string;
}): Promise<string> {
  const args: string[] = [];
  if (opts?.workspace) args.push("--workspace", opts.workspace);
  if (opts?.direction) args.push("--direction", opts.direction);
  if (opts?.type) args.push("--type", opts.type);
  if (opts?.url) args.push("--url", opts.url);
  return parseOkRef(await $`cmux new-pane ${args}`.quiet().text());
}

/** Create a new surface (tab) within an existing pane. */
export async function newSurface(opts?: {
  workspace?: string;
  pane?: string;
  type?: "terminal" | "browser";
  url?: string;
}): Promise<string> {
  const args: string[] = [];
  if (opts?.workspace) args.push("--workspace", opts.workspace);
  if (opts?.pane) args.push("--pane", opts.pane);
  if (opts?.type) args.push("--type", opts.type);
  if (opts?.url) args.push("--url", opts.url);
  return parseOkRef(await $`cmux new-surface ${args}`.quiet().text());
}

// ── Input ──

/** Send text to a surface. Use `\n` in the text for enter key. */
export async function send(
  text: string,
  opts?: { workspace?: string; surface?: string },
): Promise<void> {
  const args: string[] = [];
  if (opts?.workspace) args.push("--workspace", opts.workspace);
  if (opts?.surface) args.push("--surface", opts.surface);
  await $`cmux send ${args} ${text}`.quiet();
}

/** Send a key to a surface. */
export async function sendKey(
  key: string,
  opts?: { workspace?: string; surface?: string },
): Promise<void> {
  const args: string[] = [];
  if (opts?.workspace) args.push("--workspace", opts.workspace);
  if (opts?.surface) args.push("--surface", opts.surface);
  await $`cmux send-key ${args} ${key}`.quiet();
}

// ── Notifications ──

/** Show a native notification. */
export async function notify(
  title: string,
  body: string,
  opts?: { workspace?: string },
): Promise<void> {
  const args: string[] = ["--title", title, "--body", body];
  if (opts?.workspace) args.push("--workspace", opts.workspace);
  await $`cmux notify ${args}`.quiet();
}

// ── Parsing helpers ──

/**
 * Parse a workspace line from `cmux list-workspaces` output.
 * Format: `* workspace:1  Title  [selected]` or `  workspace:2  Title`
 */
function parseWorkspaceLine(line: string): CmuxWorkspace {
  const selected = line.startsWith("*");
  // Strip leading `* ` or `  `
  const trimmed = line.replace(/^[*\s]+/, "");
  // First token is the ref, rest is the title (possibly with [selected] suffix)
  const refMatch = trimmed.match(/^(workspace:\d+)\s+/);
  if (!refMatch) throw new Error(`Failed to parse workspace line: ${line}`);
  const ref = refMatch[1]!;
  const title = trimmed
    .slice(refMatch[0].length)
    .replace(/\s+\[selected\]\s*$/, "")
    .trim();
  const indexMatch = ref.match(/(\d+)$/);
  const index = indexMatch ? parseInt(indexMatch[1]!, 10) : 0;
  return { ref, title, selected, index };
}

/** Parse an "OK ref:N" response and return the ref. */
function parseOkRef(output: string): string {
  const match = output.trim().match(/^OK\s+(\S+)/);
  if (!match) throw new Error(`Unexpected cmux response: ${output.trim()}`);
  return match[1]!;
}
