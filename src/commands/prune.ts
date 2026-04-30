import { defineCommand } from "citty";
import * as p from "@clack/prompts";
import pc from "picocolors";
import consola from "consola";
import {
  deleteWorkspace,
  requireCoderLogin,
  workspaceStatus,
  relativeTime,
  type CoderWorkspace,
} from "../lib/coder.ts";
import { loadWorkspaces } from "../lib/workspace-cache.ts";
import { formatLogForSpinner, printCoderFailure } from "../lib/coder-ui.ts";
import * as cmux from "../lib/cmux.ts";
import { getLayoutsByCoderWorkspace, removeLayout } from "../lib/store.ts";

export async function runPrune(opts: { yes?: boolean }): Promise<void> {
  const spinner = p.spinner();
  spinner.start("Loading workspaces");
  const { fresh } = loadWorkspaces();
  const workspaces = await fresh;
  spinner.stop("Loaded workspaces");

  const stopped = workspaces.filter(
    (ws) => workspaceStatus(ws) === "stopped",
  );

  if (stopped.length === 0) {
    consola.info("No stopped workspaces to prune.");
    return;
  }

  p.log.info(
    `Found ${pc.bold(String(stopped.length))} stopped workspace${stopped.length === 1 ? "" : "s"}:`,
  );
  for (const ws of stopped) {
    const age = relativeTime(ws.latest_build.created_at);
    p.log.message(`  ${pc.cyan(ws.name)}  ${pc.dim(age + " ago")}`);
  }

  if (!opts.yes) {
    const confirmed = await p.confirm({
      message: `Delete ${stopped.length} stopped workspace${stopped.length === 1 ? "" : "s"}? This cannot be undone.`,
      initialValue: false,
    });
    if (p.isCancel(confirmed) || !confirmed) {
      p.cancel("Cancelled.");
      process.exit(0);
    }
  }

  let deleted = 0;
  let failed = 0;

  for (const ws of stopped) {
    const layouts = getLayoutsByCoderWorkspace(ws.name);
    for (const layout of layouts) {
      try {
        await cmux.closeWorkspace(layout.cmux_id);
      } catch {}
      removeLayout(layout.name);
    }

    const wsSpinner = p.spinner();
    const heading = `Deleting ${pc.cyan(ws.name)}`;
    wsSpinner.start(heading);
    try {
      await deleteWorkspace(ws.name, {
        onLine: (line) => wsSpinner.message(formatLogForSpinner(heading, line)),
      });
      wsSpinner.stop(`${pc.cyan(ws.name)} deleted`);
      deleted++;
    } catch (err) {
      wsSpinner.error(`Failed to delete ${pc.cyan(ws.name)}`);
      await printCoderFailure(err, { workspace: ws.name });
      failed++;
    }
  }

  const parts = [`Deleted ${deleted} workspace${deleted === 1 ? "" : "s"}`];
  if (failed > 0) parts.push(`${failed} failed`);
  p.outro(`${pc.green("✓")} ${parts.join(", ")}`);
}

export const pruneCommand = defineCommand({
  meta: {
    name: "prune",
    description: "Delete all stopped workspaces",
  },
  args: {
    yes: {
      type: "boolean",
      alias: "y",
      description: "Skip confirmation prompt",
      default: false,
    },
  },
  async run({ args }) {
    await requireCoderLogin();
    await runPrune({ yes: args.yes as boolean });
  },
});
