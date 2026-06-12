import { $ } from "bun";
import { consola } from "consola";
import { homedir } from "node:os";
import { join } from "node:path";
import { chmodSync } from "node:fs";
import { sshHost, sshHostWithSession, buildInteractiveSshCommand } from "./ssh.ts";
import { refreshCacheAsync } from "./workspace-cache.ts";
import type { TaskInfo, AppStatus } from "@cx/api-types";

export interface CoderWorkspace {
  id: string;
  name: string;
  owner_name: string;
  organization_name: string;
  template_name: string;
  outdated: boolean;
  latest_build: {
    status: string;
    transition: string;
    created_at: string;
    template_version_name: string;
    resources: Array<{
      agents?: Array<{
        id: string;
        name: string;
        status: string;
        lifecycle_state: string;
        display_apps?: string[];
        apps?: Array<{
          slug: string;
          display_name: string;
          icon?: string;
          url?: string;
          hidden?: boolean;
          subdomain?: boolean;
          subdomain_name?: string;
          external?: boolean;
          command?: string;
        }>;
      }>;
    }>;
  };
  health: {
    healthy: boolean;
    failing_agents: string[];
  };
  latest_app_status?: {
    state?: string;
    message?: string;
    uri?: string;
  } | null;
}

/** Project a workspace's latest agent app status onto the wire-friendly shape. */
export function coderAppStatus(ws: CoderWorkspace): AppStatus | undefined {
  const status = ws.latest_app_status;
  if (!status) return undefined;
  const state = status.state?.trim() || undefined;
  const message = status.message?.trim() || undefined;
  const uri = status.uri?.trim() || undefined;
  if (!state && !message && !uri) return undefined;
  return { state, message, uri };
}

/** Check that the user is logged in to Coder. Exits with a friendly error if not. */
export async function requireCoderLogin(): Promise<void> {
  try {
    await $`coder whoami`.quiet();
  } catch {
    consola.error(
      "Not logged in to Coder. Run `coder login` to authenticate.",
    );
    process.exit(1);
  }
}

/** Format a timestamp as a human-readable relative time string. */
export function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

/** Fetch all workspaces for the current user via `coder list --output json`. */
export async function listWorkspaces(): Promise<CoderWorkspace[]> {
  const result = await $`coder list --output json`.quiet();
  return result.json() as Promise<CoderWorkspace[]>;
}

export interface CoderTask {
  id: string;
  owner_name: string;
  display_name: string;
  workspace_id: string;
  workspace_name: string;
  workspace_status: string;
  status: string;
  current_state: { timestamp: string; state: string; message: string; uri: string } | null;
}

/**
 * Fetch the current user's Coder Tasks (all states) via `coder task list --output json`.
 * The license warning Coder may print goes to stderr, so stdout parses cleanly.
 */
export async function listTasks(): Promise<CoderTask[]> {
  const result = await $`coder task list --output json`.quiet();
  return result.json() as Promise<CoderTask[]>;
}

/**
 * Index tasks by their backing workspace id. When a workspace has multiple
 * tasks, keep the one with the latest current_state.timestamp (last seen wins on tie).
 */
export function taskByWorkspaceId(tasks: CoderTask[]): Map<string, CoderTask> {
  const map = new Map<string, CoderTask>();
  for (const task of tasks) {
    const existing = map.get(task.workspace_id);
    if (!existing) {
      map.set(task.workspace_id, task);
      continue;
    }
    const a = existing.current_state?.timestamp ?? "";
    const b = task.current_state?.timestamp ?? "";
    if (b >= a) map.set(task.workspace_id, task);
  }
  return map;
}

/** Project a CoderTask onto the wire-friendly TaskInfo shape. */
export function coderTaskToInfo(
  task: CoderTask,
  urlCtx?: { baseUrl: string; ownerName: string },
): TaskInfo {
  const uri = task.current_state?.uri || undefined;
  return {
    id: task.id,
    displayName: task.display_name.trim() || task.workspace_name,
    status: task.status,
    state: task.current_state?.state || undefined,
    message: task.current_state?.message || undefined,
    uri,
    prUrl: uri,
    url: urlCtx ? taskUrl(urlCtx.baseUrl, urlCtx.ownerName, task.id) : undefined,
  };
}

/**
 * Resolve the Coder Task UI URL for a workspace, or undefined when it backs no task.
 * Lists tasks fresh; callers that already have task data should use taskUrl() directly.
 */
export async function resolveTaskUrl(
  ws: CoderWorkspace,
  baseUrl: string,
): Promise<string | undefined> {
  const tasks = await listTasks().catch((): CoderTask[] => []);
  const task = taskByWorkspaceId(tasks).get(ws.id);
  return task ? taskUrl(baseUrl, ws.owner_name, task.id) : undefined;
}

export interface CoderTemplate {
  name: string;
  display_name: string;
  description: string;
  deprecated: boolean;
}

/** List available Coder templates. Filters out deprecated templates. */
export async function listCoderTemplates(): Promise<CoderTemplate[]> {
  const result = await $`coder templates list --output json`.quiet();
  const raw = (await result.json()) as Array<{ Template: CoderTemplate }>;
  return raw
    .map((entry) => entry.Template)
    .filter((t) => !t.deprecated);
}

export interface ListeningPort {
  /** Process that opened the socket; may be empty if the agent couldn't resolve it. */
  processName: string;
  network: string;
  port: number;
}

/** Coder/infra processes that are never useful to forward; filtered from discovery. */
const IGNORED_PORT_PROCESSES = new Set(["tailscaled", "caddy", "mainthread"]);

/** Default Coder CLI config dir per-platform (honours $CODER_CONFIG_DIR). */
function coderConfigDir(): string {
  if (process.env.CODER_CONFIG_DIR) return process.env.CODER_CONFIG_DIR;
  if (process.platform === "darwin") return join(homedir(), "Library", "Application Support", "coderv2");
  if (process.platform === "win32" && process.env.APPDATA) return join(process.env.APPDATA, "coderv2");
  return join(homedir(), ".config", "coderv2");
}

/** Where cx caches its self-minted API token, and the token's server-side name. */
const CX_TOKEN_FILE = join(homedir(), ".cx", "coder-token");
const CX_TOKEN_NAME = "cx";

/** Parse the bare token from `coder tokens create` stdout (the token is the last line). */
function parseMintedToken(stdout: string): string | undefined {
  return stdout.trim().split(/\r?\n/).filter(Boolean).pop()?.trim();
}

/**
 * Mint a least-privilege API token via `coder tokens create` (non-interactive —
 * prints the token to stdout). Caches under the name `cx` so repeated calls reuse
 * one token; recovers from a stale name collision and from deployment lifetime caps.
 */
async function mintCoderToken(): Promise<string> {
  const create = (lifetime?: string) => {
    const args = ["tokens", "create", "-n", CX_TOKEN_NAME, "--scope", "workspace:read"];
    if (lifetime) args.push("--lifetime", lifetime);
    return $`coder ${args}`.quiet().nothrow();
  };

  let res = await create("1y");
  if (res.exitCode !== 0) {
    // A `cx` token may already exist from a run whose cache was lost — replace it.
    await $`coder tokens remove ${CX_TOKEN_NAME}`.quiet().nothrow();
    res = await create("1y");
  }
  if (res.exitCode !== 0) {
    // The deployment may cap token lifetime — let it choose the default.
    res = await create();
  }
  if (res.exitCode !== 0) {
    const detail = res.stderr.toString().trim() || res.stdout.toString().trim();
    throw new Error(`Could not mint a Coder token (\`coder tokens create\`): ${detail}`);
  }
  const token = parseMintedToken(res.stdout.toString());
  if (!token) throw new Error("`coder tokens create` produced no token output");

  await Bun.write(CX_TOKEN_FILE, token);
  try {
    chmodSync(CX_TOKEN_FILE, 0o600);
  } catch {}
  return token;
}

/**
 * Resolve a Coder session token for direct REST calls. Order: $CODER_SESSION_TOKEN,
 * a file-based `session` in the Coder config dir, a previously cached cx token, then
 * mint a fresh one. Newer CLIs keep their own token in the OS keyring (not a file),
 * so cx mints its own scoped token rather than reading the keyring. Pass
 * `forceMint` to bypass every cached source (used to recover from a 401).
 */
async function coderSessionToken(opts?: { forceMint?: boolean }): Promise<string> {
  if (!opts?.forceMint) {
    const fromEnv = process.env.CODER_SESSION_TOKEN?.trim();
    if (fromEnv) return fromEnv;
    const sessionFile = Bun.file(join(coderConfigDir(), "session"));
    if (await sessionFile.exists()) {
      const token = (await sessionFile.text()).trim();
      if (token) return token;
    }
    const cached = Bun.file(CX_TOKEN_FILE);
    if (await cached.exists()) {
      const token = (await cached.text()).trim();
      if (token) return token;
    }
  }
  return mintCoderToken();
}

/** Pick the primary agent for a workspace (first connected agent, else the first). */
export function primaryAgent(ws: CoderWorkspace): { id: string; name: string } | undefined {
  const agents = ws.latest_build.resources.flatMap((r) => r.agents ?? []);
  const agent = agents.find((a) => a.status === "connected") ?? agents[0];
  return agent ? { id: agent.id, name: agent.name } : undefined;
}

/** Pick the primary agent id for a workspace (first connected agent, else the first). */
export function agentIdForWorkspace(ws: CoderWorkspace): string | undefined {
  return primaryAgent(ws)?.id;
}

/**
 * Build the Coder port-subdomain URL for a listening port, e.g.
 * `https://3000--main--myws--brock.coder.dev.ownr.dev`. Coder serves the agent's
 * port over the deployment's wildcard hostname using the same
 * `{name}--{agent}--{workspace}--{owner}` scheme as named apps' `subdomain_name`.
 */
export function portSubdomainUrl(opts: {
  ws: CoderWorkspace;
  baseUrl: string;
  port: number;
  agentName?: string;
}): string {
  const agentName = opts.agentName ?? primaryAgent(opts.ws)?.name ?? "main";
  const { protocol, host } = new URL(opts.baseUrl);
  const sub = `${opts.port}--${agentName}--${opts.ws.name}--${opts.ws.owner_name}`;
  return `${protocol}//${sub}.${host}`;
}

/**
 * Discover the ports an agent currently sees listening, via Coder's REST API
 * (`GET /api/v2/workspaceagents/{id}/listening-ports`) — the same source as the
 * dashboard's "Listening Ports" panel, process names included.
 */
export async function listeningPorts(agentId: string): Promise<ListeningPort[]> {
  const baseUrl = await getCoderUrl();
  const url = `${baseUrl}/api/v2/workspaceagents/${agentId}/listening-ports`;
  const fetchWith = (token: string) => fetch(url, { headers: { "Coder-Session-Token": token } });

  let res = await fetchWith(await coderSessionToken());
  if (res.status === 401) {
    // Cached/minted token expired or was revoked — mint a fresh one and retry once.
    res = await fetchWith(await coderSessionToken({ forceMint: true }));
  }
  if (!res.ok) {
    throw new Error(`Coder listening-ports API returned ${res.status}: ${(await res.text()).trim()}`);
  }
  const data = (await res.json()) as {
    ports?: Array<{ process_name?: string; network?: string; port: number }>;
  };
  return (data.ports ?? [])
    .map((p) => ({ processName: p.process_name?.trim() ?? "", network: p.network ?? "tcp", port: p.port }))
    .filter((p) => !IGNORED_PORT_PROCESSES.has(p.processName.toLowerCase()))
    .sort((a, b) => a.port - b.port);
}

/** Get the Coder deployment URL from `coder whoami`. */
export async function getCoderUrl(): Promise<string> {
  const output = await $`coder whoami`.quiet().text();
  // Output like: "Coder is running at https://coder.dev.ownr.dev/, You're authenticated as ..."
  const match = output.match(/running at (https?:\/\/[^\s,]+)/);
  if (!match) throw new Error("Could not determine Coder URL from `coder whoami`");
  return match[1]!.replace(/\/$/, "");
}

/** Build dashboard URL for a workspace. */
export function dashboardUrl(baseUrl: string, ownerName: string, workspaceName: string): string {
  return `${baseUrl}/@${ownerName}/${workspaceName}`;
}

/** Build the Coder Task UI URL, e.g. `${baseUrl}/tasks/${ownerName}/${taskId}`. */
export function taskUrl(baseUrl: string, ownerName: string, taskId: string): string {
  return `${baseUrl}/tasks/${ownerName}/${taskId}`;
}

/** Derive a display status from the workspace build state. */
export function workspaceStatus(ws: CoderWorkspace): "running" | "stopped" | "starting" | "stopping" | "failed" | "other" {
  const status = ws.latest_build.status;
  const transition = ws.latest_build.transition;

  if (status === "running" && transition === "start") return "running";
  if (status === "running" && transition === "stop") return "stopped";
  if (status === "succeeded" && transition === "stop") return "stopped";
  if (status === "starting") return "starting";
  if (status === "stopping") return "stopping";
  if (status === "failed") return "failed";
  if (transition === "stop") return "stopped";
  if (transition === "start") return "running";
  return "other";
}

const STALE_STOPPED_MS = 24 * 60 * 60 * 1000;

export function isStaleStoppedWorkspace(ws: CoderWorkspace): boolean {
  const s = workspaceStatus(ws);
  if (s !== "stopped") return false;
  const age = Date.now() - new Date(ws.latest_build.created_at).getTime();
  return age > STALE_STOPPED_MS;
}

/** Open a URL in the default browser. */
export async function openInBrowser(url: string): Promise<void> {
  await $`open ${url}`.quiet();
}

export interface LogStreamOpts {
  /** Called for every log line (stdout + stderr, interleaved). */
  onLine?: (line: string) => void;
}

/** Error thrown when a coder subprocess exits non-zero. Carries a ring buffer of the last log lines. */
export class CoderCommandError extends Error {
  command: string;
  code: number;
  tail: string[];
  constructor(command: string, code: number, tail: string[]) {
    super(`coder ${command} exited with code ${code}`);
    this.name = "CoderCommandError";
    this.command = command;
    this.code = code;
    this.tail = tail;
  }
}

const LOG_TAIL_SIZE = 20;

/**
 * Spawn a coder subprocess, streaming stdout + stderr line-by-line into a ring buffer.
 * When onLine is provided, lines are delivered only to the callback. Otherwise they are
 * echoed to stderr (preserving the legacy "inherit" behavior for callers that haven't opted in).
 */
async function runCoderProcess(
  args: string[],
  opts?: LogStreamOpts,
): Promise<{ code: number; tail: string[] }> {
  const tail: string[] = [];
  const pushLine = (line: string) => {
    if (!line) return;
    tail.push(line);
    if (tail.length > LOG_TAIL_SIZE) tail.shift();
    if (opts?.onLine) {
      opts.onLine(line);
    } else {
      process.stderr.write(line + "\n");
    }
  };

  const proc = Bun.spawn(args, {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });

  const drain = async (stream: ReadableStream<Uint8Array> | null) => {
    if (!stream) return;
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) pushLine(line);
      }
      if (buffer) pushLine(buffer);
    } catch {}
  };

  await Promise.all([drain(proc.stdout), drain(proc.stderr)]);
  const code = await proc.exited;
  return { code, tail };
}

/**
 * Create a new Coder workspace. Runs with inherited stdio so the user can answer
 * prompts for required parameters that have no default and aren't covered by the
 * preset — piping stdin would cause `coder create` to fail with "prepare build: EOF".
 */
export async function createWorkspace(
  name: string,
  template: string,
  opts?: { params?: Record<string, string>; preset?: string },
): Promise<void> {
  const args = ["coder", "create", "-t", template, name, "-y", "--use-parameter-defaults"];
  if (opts?.preset) {
    args.push("--preset", opts.preset);
  }
  if (opts?.params) {
    for (const [key, value] of Object.entries(opts.params)) {
      const pair = `${key}=${value}`;
      const escaped = /[",\n\r]/.test(pair) ? `"${pair.replace(/"/g, '""')}"` : pair;
      args.push("--parameter", escaped);
    }
  }
  const proc = Bun.spawn(args, {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  const code = await proc.exited;
  if (code !== 0) throw new CoderCommandError("create", code, []);
  refreshCacheAsync();
}

/**
 * Create a Coder Task (an agent session in its own ephemeral workspace). Unlike
 * `createWorkspace`, `--preset` makes this non-interactive, so we capture stdout
 * (`-q` prints just the task id) and parse the first non-empty line.
 */
export async function createTask(
  prompt: string,
  opts: { template: string; preset?: string },
): Promise<string> {
  const args = ["task", "create", "-q", "--template", opts.template];
  if (opts.preset) args.push("--preset", opts.preset);
  args.push(prompt); // Bun.$ auto-quotes the interpolated array
  const result = await $`coder ${args}`.quiet();
  const id = (await result.text()).trim().split(/\r?\n/).find(Boolean)?.trim();
  if (!id) throw new Error("Could not parse task id from `coder task create`");
  refreshCacheAsync();
  return id;
}

/** Stop a running Coder workspace. */
export async function stopWorkspace(name: string, opts?: LogStreamOpts): Promise<void> {
  const { code, tail } = await runCoderProcess(["coder", "stop", name, "-y"], opts);
  if (code !== 0) throw new CoderCommandError("stop", code, tail);
  refreshCacheAsync();
}

/** Start a stopped Coder workspace. Streams build logs through opts.onLine (defaults to stderr). */
export async function startWorkspace(name: string, opts?: LogStreamOpts): Promise<void> {
  const { code, tail } = await runCoderProcess(["coder", "start", name], opts);
  if (code !== 0) throw new CoderCommandError("start", code, tail);
  refreshCacheAsync();
}

/**
 * Poll until a workspace is running with a connected agent.
 * Streams build logs via `coder logs -f` while waiting, keeping a ring buffer of the
 * last lines. On timeout or agent start_error, throws a CoderCommandError with that tail.
 */
export async function waitForWorkspace(
  name: string,
  timeoutMs = 15 * 60 * 1000,
  onLog?: (line: string) => void,
): Promise<void> {
  const tail: string[] = [];

  const logProc = Bun.spawn(["coder", "logs", "-f", name], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });

  const drain = async (stream: ReadableStream<Uint8Array> | null) => {
    if (!stream) return;
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line) continue;
          tail.push(line);
          if (tail.length > LOG_TAIL_SIZE) tail.shift();
          if (onLog) onLog(line);
        }
      }
      if (buffer) {
        tail.push(buffer);
        if (tail.length > LOG_TAIL_SIZE) tail.shift();
        if (onLog) onLog(buffer);
      }
    } catch {}
  };

  void drain(logProc.stdout);
  void drain(logProc.stderr);

  try {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const workspaces = await listWorkspaces();
      const ws = workspaces.find((w) => w.name === name);
      if (ws && workspaceStatus(ws) === "running") {
        const agents = ws.latest_build.resources.flatMap((r) => r.agents ?? []);
        const allConnected = agents.length > 0 && agents.every((a) => a.status === "connected");
        const allReady = allConnected && agents.every((a) => a.lifecycle_state === "ready");
        if (allReady) return;
        if (allConnected && agents.some((a) => a.lifecycle_state === "start_error" || a.lifecycle_state === "start_timeout")) {
          const bad = agents.find((a) => a.lifecycle_state === "start_error" || a.lifecycle_state === "start_timeout")!;
          throw new CoderCommandError(
            `logs ${name}`,
            -1,
            [...tail, `Agent ${bad.name} startup ${bad.lifecycle_state}`],
          );
        }
      }
      await Bun.sleep(3000);
    }
    throw new CoderCommandError(
      `logs ${name}`,
      -1,
      [...tail, `Timed out waiting for workspace "${name}" to be ready`],
    );
  } finally {
    logProc.kill();
  }
}

/** Ensure SSH config is up to date for Coder workspaces. */
export async function ensureSshConfig(): Promise<void> {
  await $`coder config-ssh -y`.quiet();
}

/** Run a one-off command on a workspace via SSH. Returns the exit code. */
export async function execOnWorkspace(workspaceName: string, command: string[]): Promise<number> {
  const host = await sshHost(workspaceName);
  const proc = Bun.spawn(["ssh", host, "--", ...command], {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  return proc.exited;
}

/** Open a workspace in VS Code via the Coder CLI. */
export async function openInVSCode(workspaceName: string): Promise<void> {
  await $`coder open vscode ${workspaceName} --generate-token`.quiet();
}

export interface WorkspaceApp {
  slug: string;
  displayName: string;
  subdomainName?: string;
  url?: string;
}

export interface WorkspaceContext {
  name: string;
  templateName: string;
  apps: WorkspaceApp[];
  /** Absolute URL for a named app (subdomain preferred). Throws if missing. */
  appUrl(slug: string): string;
  raw: CoderWorkspace;
}

/** Build a WorkspaceContext view of a CoderWorkspace for template functions. */
export function buildWorkspaceContext(ws: CoderWorkspace, coderBaseUrl?: string): WorkspaceContext {
  const apps: WorkspaceApp[] = ws.latest_build.resources
    .flatMap((r) => r.agents ?? [])
    .flatMap((a) => a.apps ?? [])
    .map((a) => ({
      slug: a.slug,
      displayName: a.display_name,
      subdomainName: a.subdomain_name,
      url: a.url,
    }));

  const base = (coderBaseUrl ?? "").replace(/\/$/, "");

  return {
    name: ws.name,
    templateName: ws.template_name,
    apps,
    appUrl(slug: string): string {
      const app = apps.find((a) => a.slug === slug);
      if (!app) {
        throw new Error(`Workspace "${ws.name}" has no app with slug "${slug}"`);
      }
      if (app.subdomainName) {
        if (!base) {
          throw new Error(`Coder base URL required to resolve subdomain URL for app "${slug}"`);
        }
        const host = new URL(base).host;
        const protocol = new URL(base).protocol;
        return `${protocol}//${app.subdomainName}.${host}`;
      }
      if (app.url) return app.url;
      throw new Error(`App "${slug}" on workspace "${ws.name}" has no resolvable URL`);
    },
    raw: ws,
  };
}

/** List all openable apps for a workspace (Dashboard, VS Code, and custom apps). */
export function listOpenableApps(ws: CoderWorkspace): Array<{ slug: string; label: string; icon?: string }> {
  const agents = ws.latest_build.resources.flatMap(r => r.agents ?? []);
  const displayApps = new Set(agents.flatMap(a => a.display_apps ?? []));
  const apps: Array<{ slug: string; label: string; icon?: string }> = [];

  // Dashboard is always available
  apps.push({ slug: "dashboard", label: "Dashboard" });

  // VS Code if enabled
  if (displayApps.has("vscode")) {
    apps.push({ slug: "vscode", label: "VS Code" });
  }

  // All non-hidden coder_apps, sorted alphabetically by label
  const custom: Array<{ slug: string; label: string; icon?: string }> = [];
  for (const agent of agents) {
    for (const app of agent.apps ?? []) {
      if (!app.hidden) {
        custom.push({ slug: app.slug, label: app.display_name, icon: app.icon });
      }
    }
  }
  custom.sort((a, b) => a.label.localeCompare(b.label));
  apps.push(...custom);

  return apps;
}

/** Open a workspace app via `coder open app`. */
export async function openWorkspaceApp(workspaceName: string, slug: string): Promise<void> {
  await $`coder open app ${workspaceName} ${slug}`.quiet();
}

/** Stream workspace agent logs. Returns the exit code. */
export async function streamLogs(
  workspaceName: string,
  opts?: { follow?: boolean; build?: number },
): Promise<number> {
  const args = ["coder", "logs", workspaceName];
  if (opts?.follow) args.push("--follow");
  if (opts?.build !== undefined) args.push("--build-number", String(opts.build));
  const proc = Bun.spawn(args, {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  return proc.exited;
}

/** Update an outdated workspace to the latest template version. */
export async function updateWorkspace(name: string, opts?: LogStreamOpts): Promise<void> {
  const { code, tail } = await runCoderProcess(["coder", "update", name, "-y"], opts);
  if (code !== 0) throw new CoderCommandError("update", code, tail);
  refreshCacheAsync();
}

/** Restart a running Coder workspace. */
export async function restartWorkspace(name: string, opts?: LogStreamOpts): Promise<void> {
  const { code, tail } = await runCoderProcess(["coder", "restart", name, "-y"], opts);
  if (code !== 0) throw new CoderCommandError("restart", code, tail);
  refreshCacheAsync();
}

/** Delete a Coder workspace. */
export async function deleteWorkspace(
  name: string,
  opts?: { orphan?: boolean } & LogStreamOpts,
): Promise<void> {
  const args = ["coder", "delete", name, "-y"];
  if (opts?.orphan) args.push("--orphan");
  const { code, tail } = await runCoderProcess(args, opts);
  if (code !== 0) throw new CoderCommandError("delete", code, tail);
  refreshCacheAsync();
}

/** SSH into a workspace (replaces the current process). */
export async function sshIntoWorkspace(workspaceName: string, session?: string): Promise<void> {
  const host = session
    ? await sshHostWithSession(workspaceName, session)
    : await sshHost(workspaceName);
  const cmd = await buildInteractiveSshCommand(host);
  const proc = Bun.spawn(["bash", "-c", cmd], {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  const code = await proc.exited;
  process.exit(code);
}
