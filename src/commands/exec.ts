import { defineCommand } from "citty";
import { consola } from "consola";
import pc from "picocolors";
import { execOnWorkspace, workspaceStatus } from "../lib/coder.ts";
import { pickWorkspace } from "../lib/workspace-picker.ts";

export const execCommand = defineCommand({
  meta: {
    name: "exec",
    description: "Run a command on a Coder workspace via SSH",
  },
  args: {
    workspace: {
      type: "positional",
      description: "Workspace name (fuzzy matched, or pick interactively)",
      required: false,
    },
  },
  async run({ args, rawArgs }) {
    // Everything after "--" is the command to execute
    const dashIdx = rawArgs.indexOf("--");
    const command = dashIdx >= 0 ? rawArgs.slice(dashIdx + 1) : [];

    if (command.length === 0) {
      consola.error("No command specified. Usage: coder exec [workspace] -- <command>");
      process.exit(1);
    }

    const ws = await pickWorkspace({
      filter: args.workspace as string | undefined,
      message: "Select a workspace to run command on",
    });

    if (!ws) {
      consola.warn(
        args.workspace
          ? `No workspaces matching "${args.workspace}"`
          : "No workspaces found.",
      );
      process.exit(1);
    }

    if (workspaceStatus(ws) !== "running") {
      consola.error(`Workspace ${pc.bold(ws.name)} is not running (status: ${workspaceStatus(ws)})`);
      process.exit(1);
    }

    consola.info(`Running on ${pc.bold(ws.name)}: ${pc.dim(command.join(" "))}`);
    const exitCode = await execOnWorkspace(ws.name, command);
    process.exit(exitCode);
  },
});
