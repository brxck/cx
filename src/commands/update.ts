import { defineCommand } from "citty";
import * as p from "@clack/prompts";
import consola from "consola";
import pc from "picocolors";
import {
  requireCoderLogin,
  listWorkspaces,
  updateWorkspace,
} from "../lib/coder.ts";
import { formatLogForSpinner, printCoderFailure } from "../lib/coder-ui.ts";

export const updateCommand = defineCommand({
  meta: {
    name: "update",
    description: "Update a workspace to the latest template version",
  },
  args: {
    workspace: {
      type: "positional",
      required: false,
      description: "Workspace to update",
    },
  },
  async run({ args }) {
    await requireCoderLogin();

    const workspaces = await listWorkspaces();

    let wsName = args.workspace as string | undefined;
    if (!wsName) {
      const outdated = workspaces.filter((ws) => ws.outdated);
      if (outdated.length === 0) {
        consola.info("All workspaces are up to date");
        return;
      }
      const choice = await p.autocomplete({
        message: "Select workspace to update",
        options: outdated.map((ws) => ({ value: ws.name, label: ws.name })),
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

    if (!ws.outdated) {
      consola.info(`${pc.cyan(wsName)} is already up to date`);
      return;
    }

    const spinner = p.spinner();
    const heading = `Updating ${pc.cyan(wsName)} to latest template`;
    spinner.start(heading);
    try {
      await updateWorkspace(wsName, {
        onLine: (line) => spinner.message(formatLogForSpinner(heading, line)),
      });
      spinner.stop(`${pc.cyan(wsName)} updated`);
    } catch (err) {
      spinner.error(`Failed to update ${pc.cyan(wsName)}`);
      await printCoderFailure(err, { workspace: wsName });
      throw err;
    }
  },
});
