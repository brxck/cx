import { defineCommand } from "citty";
import { consola } from "consola";
import * as p from "@clack/prompts";
import pc from "picocolors";
import {
  listWorkspaces,
  getCoderUrl,
  dashboardUrl,
  workspaceStatus,
  relativeTime,
  openInBrowser,
  sshIntoWorkspace,
  type CoderWorkspace,
} from "../lib/coder.ts";

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

function formatWorkspaceLabel(ws: CoderWorkspace): string {
  const parts = [
    pc.bold(ws.latest_build.template_version_name),
    statusBadge(ws),
    healthBadge(ws),
    pc.dim(`built ${relativeTime(ws.latest_build.created_at)} ago`),
    pc.dim(ws.name),
  ];
  return parts.join("  ");
}

function fuzzyMatch(query: string, target: string): boolean {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  return qi === q.length;
}

export const listCommand = defineCommand({
  meta: {
    name: "list",
    description: "List and interact with your Coder workspaces",
  },
  args: {
    filter: {
      type: "positional",
      description: "Fuzzy filter string for workspace names",
      required: false,
    },
    interactive: {
      type: "boolean",
      description: "Enable interactive selection (default: true)",
      default: true,
    },
  },
  async run({ args }) {
    const spinner = p.spinner();
    spinner.start("Fetching workspaces");

    let workspaces: CoderWorkspace[];
    let coderBaseUrl: string;
    try {
      [workspaces, coderBaseUrl] = await Promise.all([
        listWorkspaces(),
        getCoderUrl(),
      ]);
    } catch (e) {
      spinner.stop("Failed to fetch workspaces");
      consola.error(
        "Could not reach Coder. Make sure `coder` is installed and you are logged in."
      );
      process.exit(1);
    }

    spinner.stop(`Found ${workspaces.length} workspace${workspaces.length === 1 ? "" : "s"}`);

    if (workspaces.length === 0) {
      consola.info("No workspaces found.");
      return;
    }

    // Apply filter if provided
    let filtered = workspaces;
    if (args.filter) {
      filtered = workspaces.filter((ws) => fuzzyMatch(args.filter as string, ws.name));
      if (filtered.length === 0) {
        consola.warn(`No workspaces matching "${args.filter}"`);
        return;
      }
    }

    // Sort: running first, then alphabetical
    filtered.sort((a, b) => {
      const aRunning = workspaceStatus(a) === "running" ? 0 : 1;
      const bRunning = workspaceStatus(b) === "running" ? 0 : 1;
      if (aRunning !== bRunning) return aRunning - bRunning;
      return a.name.localeCompare(b.name);
    });

    // Non-interactive: just print and exit
    if (!args.interactive) {
      for (const ws of filtered) {
        consola.log(formatWorkspaceLabel(ws));
      }
      return;
    }

    // Interactive: select a workspace, then pick an action
    const selected = await p.select({
      message: "Select a workspace",
      options: filtered.map((ws) => ({
        value: ws.name,
        label: formatWorkspaceLabel(ws),
      })),
    });

    if (p.isCancel(selected)) {
      p.cancel("Cancelled.");
      process.exit(0);
    }

    const ws = filtered.find((w) => w.name === selected)!;

    const action = await p.select({
      message: `Action for ${pc.bold(ws.name)}`,
      options: [
        { value: "ssh", label: "SSH into workspace" },
        {
          value: "dashboard",
          label: "Open in Coder dashboard",
          hint: dashboardUrl(coderBaseUrl, ws.owner_name, ws.name),
        },
      ],
    });

    if (p.isCancel(action)) {
      p.cancel("Cancelled.");
      process.exit(0);
    }

    switch (action) {
      case "dashboard": {
        const url = dashboardUrl(coderBaseUrl, ws.owner_name, ws.name);
        consola.info(`Opening ${pc.underline(url)}`);
        await openInBrowser(url);
        break;
      }
      case "ssh": {
        consola.info(`Connecting to ${pc.bold(ws.name)} via SSH...`);
        await sshIntoWorkspace(ws.name);
        break;
      }
    }
  },
});
