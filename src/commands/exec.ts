import { defineCommand } from "citty";
import { consola } from "consola";
import pc from "picocolors";
import {
  execOnWorkspace,
  workspaceStatus,
  requireCoderLogin,
  type CoderWorkspace,
} from "../lib/coder.ts";
import { pickWorkspace } from "../lib/workspace-picker.ts";

export interface RunExecOpts {
  ws: CoderWorkspace;
  command: string[];
}

export async function runExec(opts: RunExecOpts): Promise<number> {
  const { ws, command } = opts;

  if (command.length === 0) {
    consola.error("No command specified.");
    return 1;
  }

  if (workspaceStatus(ws) !== "running") {
    consola.error(`Workspace ${pc.bold(ws.name)} is not running (status: ${workspaceStatus(ws)})`);
    return 1;
  }

  consola.info(`Running on ${pc.bold(ws.name)}: ${pc.dim(command.join(" "))}`);
  return execOnWorkspace(ws.name, command);
}

export const execCommand = defineCommand({
  meta: {
    name: "exec",
    description: "Run a command on a Coder workspace via SSH",
  },
  args: {
    workspace: {
      type: "positional",
      description: "Workspace name",
      required: false,
    },
  },
  async run({ args, rawArgs }) {
    await requireCoderLogin();

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

    const exitCode = await runExec({ ws, command });
    process.exit(exitCode);
  },
});
