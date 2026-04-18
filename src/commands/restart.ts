import { defineCommand } from "citty";
import * as p from "@clack/prompts";
import consola from "consola";
import pc from "picocolors";
import {
  requireCoderLogin,
  listWorkspaces,
  workspaceStatus,
  restartWorkspace,
  type CoderWorkspace,
} from "../lib/coder.ts";

export interface RunRestartOpts {
  ws: CoderWorkspace;
}

export async function runRestart(opts: RunRestartOpts): Promise<void> {
  const { ws } = opts;
  consola.start(`Restarting ${pc.cyan(ws.name)}...`);
  await restartWorkspace(ws.name);
  consola.success(`${pc.cyan(ws.name)} restarted`);
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

    const workspaces = await listWorkspaces();

    let wsName = args.workspace as string | undefined;
    if (!wsName) {
      const running = workspaces.filter(
        (ws) => workspaceStatus(ws) === "running",
      );
      if (running.length === 0) {
        consola.warn("No running workspaces to restart");
        return;
      }
      const choice = await p.autocomplete({
        message: "Select workspace to restart",
        options: running.map((ws) => ({ value: ws.name, label: ws.name })),
        placeholder: "Type to filter",
      });
      if (p.isCancel(choice)) return;
      wsName = choice;
    }

    const ws = workspaces.find((w) => w.name === wsName);
    if (!ws) {
      consola.error(`Workspace "${wsName}" not found`);
      process.exit(1);
    }

    await runRestart({ ws });
  },
});
