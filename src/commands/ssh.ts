import { defineCommand } from "citty";
import { consola } from "consola";
import pc from "picocolors";
import { sshIntoWorkspace } from "../lib/coder.ts";
import { pickWorkspace } from "../lib/workspace-picker.ts";

export const sshCommand = defineCommand({
  meta: {
    name: "ssh",
    description: "SSH into a Coder workspace",
  },
  args: {
    workspace: {
      type: "positional",
      description: "Workspace name (fuzzy matched, or pick interactively)",
      required: false,
    },
  },
  async run({ args }) {
    const ws = await pickWorkspace({
      filter: args.workspace as string | undefined,
      message: "Select a workspace to SSH into",
    });

    if (!ws) {
      consola.warn(
        args.workspace
          ? `No workspaces matching "${args.workspace}"`
          : "No workspaces found."
      );
      process.exit(1);
    }

    consola.info(`Connecting to ${pc.bold(ws.name)} via SSH...`);
    await sshIntoWorkspace(ws.name);
  },
});
