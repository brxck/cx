import { defineCommand } from "citty";
import { consola } from "consola";
import pc from "picocolors";
import { streamLogs, requireCoderLogin } from "../lib/coder.ts";
import { pickWorkspace } from "../lib/workspace-picker.ts";

export const logsCommand = defineCommand({
  meta: {
    name: "logs",
    description: "Stream workspace agent logs",
  },
  args: {
    workspace: {
      type: "positional",
      description: "Workspace name (fuzzy matched, or pick interactively)",
      required: false,
    },
    follow: {
      type: "boolean",
      alias: "f",
      description: "Follow log output",
      default: true,
    },
    build: {
      type: "string",
      alias: "n",
      description: "Build number (default: latest)",
      required: false,
    },
  },
  async run({ args }) {
    await requireCoderLogin();

    const ws = await pickWorkspace({
      filter: args.workspace as string | undefined,
      message: "Select a workspace to view logs",
    });

    if (!ws) {
      consola.warn(
        args.workspace
          ? `No workspaces matching "${args.workspace}"`
          : "No workspaces found.",
      );
      process.exit(1);
    }

    consola.info(`Streaming logs for ${pc.bold(ws.name)}...`);
    const exitCode = await streamLogs(ws.name, {
      follow: args.follow as boolean,
      build: args.build ? Number(args.build) : undefined,
    });
    process.exit(exitCode);
  },
});
