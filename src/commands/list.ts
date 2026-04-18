import { defineCommand } from "citty";
import { consola } from "consola";
import * as p from "@clack/prompts";
import pc from "picocolors";
import {
  listWorkspaces,
  getCoderUrl,
  workspaceStatus,
  requireCoderLogin,
  type CoderWorkspace,
} from "../lib/coder.ts";
import { formatWorkspaceLabel, fuzzyMatch } from "../lib/workspace-picker.ts";
import { getLayoutsByCoderWorkspace } from "../lib/store.ts";
import {
  WORKSPACE_ACTIONS,
  buildActionOptions,
} from "../lib/workspace-actions.ts";

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
    await requireCoderLogin();

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
    const selected = await p.autocomplete({
      message: "Select a workspace",
      options: filtered.map((ws) => ({
        value: ws.name,
        label: formatWorkspaceLabel(ws),
      })),
      placeholder: "Type to filter",
    });

    if (p.isCancel(selected)) {
      p.cancel("Cancelled.");
      process.exit(0);
    }

    const ws = filtered.find((w) => w.name === selected)!;
    const layouts = getLayoutsByCoderWorkspace(ws.name);
    const available = WORKSPACE_ACTIONS.filter((a) => a.isAvailable({ ws, layouts }));
    const ctx = { ws, layouts, coderBaseUrl };
    const options = buildActionOptions(available, ctx);

    const choice = await p.autocomplete({
      message: `Action for ${pc.bold(ws.name)}`,
      options,
      placeholder: "Type to filter",
    });

    if (p.isCancel(choice)) {
      p.cancel("Cancelled.");
      process.exit(0);
    }

    const action = available.find((a) => a.id === choice);
    if (!action) {
      consola.error(`Unknown action: ${choice}`);
      process.exit(1);
    }
    await action.run(ctx);
  },
});
