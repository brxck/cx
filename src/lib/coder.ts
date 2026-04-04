import { $ } from "bun";

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
      }>;
    }>;
  };
  health: {
    healthy: boolean;
    failing_agents: string[];
  };
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

/** Create a new Coder workspace. Streams build logs to stderr. */
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
      args.push("--parameter", `${key}=${value}`);
    }
  }
  const proc = Bun.spawn(args, {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  const code = await proc.exited;
  if (code !== 0) throw new Error(`coder create exited with code ${code}`);
}

/** Stop a running Coder workspace. */
export async function stopWorkspace(name: string): Promise<void> {
  const proc = Bun.spawn(["coder", "stop", name, "-y"], {
    stdin: "ignore",
    stdout: "inherit",
    stderr: "inherit",
  });
  const code = await proc.exited;
  if (code !== 0) throw new Error(`coder stop exited with code ${code}`);
}

/** Start a stopped Coder workspace. Streams build logs to stderr. */
export async function startWorkspace(name: string): Promise<void> {
  const proc = Bun.spawn(["coder", "start", name], {
    stdin: "ignore",
    stdout: "inherit",
    stderr: "inherit",
  });
  const code = await proc.exited;
  if (code !== 0) throw new Error(`coder start exited with code ${code}`);
}

/**
 * Poll until a workspace is running with a connected agent.
 * Streams build logs via `coder logs -f` while waiting.
 * Throws after timeout (default 5 minutes).
 */
export async function waitForWorkspace(
  name: string,
  timeoutMs = 5 * 60 * 1000,
): Promise<void> {
  // Stream build logs in the background
  const logProc = Bun.spawn(["coder", "logs", "-f", name], {
    stdin: "ignore",
    stdout: "inherit",
    stderr: "inherit",
  });

  try {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const workspaces = await listWorkspaces();
      const ws = workspaces.find((w) => w.name === name);
      if (ws && workspaceStatus(ws) === "running") {
        const agents = ws.latest_build.resources.flatMap((r) => r.agents ?? []);
        const allConnected = agents.length > 0 && agents.every((a) => a.status === "connected");
        if (allConnected) return;
      }
      await Bun.sleep(3000);
    }
    throw new Error(`Timed out waiting for workspace "${name}" to be ready`);
  } finally {
    logProc.kill();
  }
}

/** Ensure SSH config is up to date for Coder workspaces. */
export async function ensureSshConfig(): Promise<void> {
  await $`coder config-ssh -y`.quiet();
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
