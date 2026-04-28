import { defineCommand } from "citty";
import * as p from "@clack/prompts";
import consola from "consola";
import pc from "picocolors";
import {
  requireCoderLogin,
  updateWorkspace,
  type CoderWorkspace,
} from "../lib/coder.ts";
import { loadWorkspaces } from "../lib/workspace-cache.ts";
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
      let outdated = workspaces.filter((ws) => ws.outdated);
      if (outdated.length === 0 && usedCache) {
        workspaces = await fresh;
        usedCache = false;
        outdated = workspaces.filter((ws) => ws.outdated);
      }
      if (outdated.length === 0) {
        consola.info("All workspaces are up to date");
        return;
      }
      const message = usedCache
        ? `Select workspace to update ${pc.dim("• refreshing…")}`
        : "Select workspace to update";
      const choice = await p.autocomplete({
        message,
        options: () =>
          workspaces
            .filter((ws) => ws.outdated)
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
