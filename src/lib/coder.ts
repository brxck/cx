import { $ } from "bun";
import { consola } from "consola";
import { sshHost } from "./ssh.ts";

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

/** Create a new Coder workspace. Streams build logs through opts.onLine (defaults to stderr). */
export async function createWorkspace(
  name: string,
  template: string,
  opts?: { params?: Record<string, string>; preset?: string } & LogStreamOpts,
): Promise<void> {
  const args = ["coder", "create", "-t", template, name, "-y", "--use-parameter-defaults"];
  if (opts?.preset) {
    args.push("--preset", opts.preset);
  }
  if (opts?.params) {
    for (const [key, value] of Object.entries(opts.params)) {
      args.push("--parameter", `${key}=${value}`);
    }
  }
  const { code, tail } = await runCoderProcess(args, opts);
  if (code !== 0) throw new CoderCommandError("create", code, tail);
}

/** Stop a running Coder workspace. */
export async function stopWorkspace(name: string, opts?: LogStreamOpts): Promise<void> {
  const { code, tail } = await runCoderProcess(["coder", "stop", name, "-y"], opts);
  if (code !== 0) throw new CoderCommandError("stop", code, tail);
}

/** Start a stopped Coder workspace. Streams build logs through opts.onLine (defaults to stderr). */
export async function startWorkspace(name: string, opts?: LogStreamOpts): Promise<void> {
  const { code, tail } = await runCoderProcess(["coder", "start", name], opts);
  if (code !== 0) throw new CoderCommandError("start", code, tail);
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
export function listOpenableApps(ws: CoderWorkspace): Array<{ slug: string; label: string }> {
  const agents = ws.latest_build.resources.flatMap(r => r.agents ?? []);
  const displayApps = new Set(agents.flatMap(a => a.display_apps ?? []));
  const apps: Array<{ slug: string; label: string }> = [];

  // Dashboard is always available
  apps.push({ slug: "dashboard", label: "Dashboard" });

  // VS Code if enabled
  if (displayApps.has("vscode")) {
    apps.push({ slug: "vscode", label: "VS Code" });
  }

  // All non-hidden coder_apps
  for (const agent of agents) {
    for (const app of agent.apps ?? []) {
      if (!app.hidden) {
        apps.push({ slug: app.slug, label: app.display_name });
      }
    }
  }

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
}

/** Restart a running Coder workspace. */
export async function restartWorkspace(name: string, opts?: LogStreamOpts): Promise<void> {
  const { code, tail } = await runCoderProcess(["coder", "restart", name, "-y"], opts);
  if (code !== 0) throw new CoderCommandError("restart", code, tail);
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
}

/** SSH into a workspace (replaces the current process). */
export async function sshIntoWorkspace(workspaceName: string, session?: string): Promise<void> {
  const host = session ? `${workspaceName}.${session}` : workspaceName;
  const proc = Bun.spawn(["coder", "ssh", host], {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  const code = await proc.exited;
  process.exit(code);
}
