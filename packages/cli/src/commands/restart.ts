import { defineCommand } from "citty";
import * as p from "@clack/prompts";
import consola from "consola";
import pc from "picocolors";
import {
  requireCoderLogin,
  workspaceStatus,
  restartWorkspace,
  type CoderWorkspace,
} from "../lib/coder.ts";
import { loadWorkspaces } from "../lib/workspace-cache.ts";
import { formatLogForSpinner, printCoderFailure } from "../lib/coder-ui.ts";

export interface RunRestartOpts {
  ws: CoderWorkspace;
}

export async function runRestart(opts: RunRestartOpts): Promise<void> {
  const { ws } = opts;
  const spinner = p.spinner();
  const heading = `Restarting ${pc.cyan(ws.name)}`;
  spinner.start(heading);
  try {
    await restartWorkspace(ws.name, {
      onLine: (line) => spinner.message(formatLogForSpinner(heading, line)),
    });
    spinner.stop(`${pc.cyan(ws.name)} restarted`);
  } catch (err) {
    spinner.error(`Failed to restart ${pc.cyan(ws.name)}`);
    await printCoderFailure(err, { workspace: ws.name });
    throw err;
  }
}

export const restartCommand = defineCommand({
  meta: {
    name: "restart",
    description: "Restart a workspace",
  },
  args: {
    workspace: {
      type: "positional",
      required: false,
      description: "Workspace to restart",
    },
  },
  async run({ args }) {
    await requireCoderLogin();

    const { cached, fresh } = loadWorkspaces();
    let workspaces: CoderWorkspace[];
    let usedCache = false;
    if (cached && cached.workspaces.length > 0) {
      workspaces = cached.workspaces;
      usedCache = true;
      fresh.then((list) => { workspaces = list; }).catch(() => {});
    } else {
      workspaces = await fresh;
    }

    let wsName = args.workspace as string | undefined;
    if (!wsName) {
      let running = workspaces.filter((ws) => workspaceStatus(ws) === "running");
      if (running.length === 0 && usedCache) {
        workspaces = await fresh;
        usedCache = false;
        running = workspaces.filter((ws) => workspaceStatus(ws) === "running");
      }
      if (running.length === 0) {
        consola.warn("No running workspaces to restart");
        return;
      }
      const message = usedCache
        ? `Select workspace to restart ${pc.dim("• refreshing…")}`
        : "Select workspace to restart";
      const choice = await p.autocomplete({
        message,
        options: () =>
          workspaces
            .filter((ws) => workspaceStatus(ws) === "running")
            .map((ws) => ({ value: ws.name, label: ws.name })),
        placeholder: "Type to filter",
      });
      if (p.isCancel(choice)) return;
      wsName = choice;
    }

    const live = await fresh.catch(() => workspaces);
    const ws = live.find((w) => w.name === wsName);
    if (!ws) {
      consola.error(`Workspace "${wsName}" not found`);
      process.exit(1);
    }
    if (workspaceStatus(ws) !== "running") {
      consola.error(`Workspace "${wsName}" is no longer running`);
      process.exit(1);
    }

    await runRestart({ ws });
  },
});
