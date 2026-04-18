import { defineCommand } from "citty";
import { consola } from "consola";
import pc from "picocolors";
import {
  streamLogs,
  requireCoderLogin,
  type CoderWorkspace,
} from "../lib/coder.ts";
import { pickWorkspace } from "../lib/workspace-picker.ts";

export interface RunLogsOpts {
  ws: CoderWorkspace;
  follow?: boolean;
  build?: number;
}

export async function runLogs(opts: RunLogsOpts): Promise<number> {
  const { ws } = opts;
  consola.info(`Streaming logs for ${pc.bold(ws.name)}...`);
  return streamLogs(ws.name, {
    follow: opts.follow,
    build: opts.build,
  });
}

export const logsCommand = defineCommand({
  meta: {
    name: "logs",
    description: "Stream workspace agent logs",
  },
  args: {
    workspace: {
      type: "positional",
      description: "Workspace name",
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

    const exitCode = await runLogs({
      ws,
      follow: args.follow as boolean,
      build: args.build ? Number(args.build) : undefined,
    });
    process.exit(exitCode);
  },
});
