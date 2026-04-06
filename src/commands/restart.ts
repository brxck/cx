import { defineCommand } from "citty";
import * as p from "@clack/prompts";
import consola from "consola";
import pc from "picocolors";
import {
  requireCoderLogin,
  listWorkspaces,
  workspaceStatus,
  restartWorkspace,
} from "../lib/coder.ts";

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
      const choice = await p.select({
        message: "Select workspace to restart",
        options: running.map((ws) => ({ value: ws.name, label: ws.name })),
      });
      if (p.isCancel(choice)) return;
      wsName = choice;
    }

    const ws = workspaces.find((w) => w.name === wsName);
    if (!ws) {
      consola.error(`Workspace "${wsName}" not found`);
      process.exit(1);
    }

    consola.start(`Restarting ${pc.cyan(wsName)}...`);
    await restartWorkspace(wsName);
    consola.success(`${pc.cyan(wsName)} restarted`);
  },
});
