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
import { printCoderFailure } from "../lib/coder-ui.ts";
import * as cmux from "../lib/cmux.ts";
import { getLayoutsByCoderWorkspace, removeLayout } from "../lib/store.ts";

export async function runPrune(opts: { yes?: boolean; unhealthy?: boolean }): Promise<void> {
  const spinner = p.spinner();
  spinner.start("Loading workspaces");
  const { fresh } = loadWorkspaces();
  const workspaces = await fresh;
  spinner.stop("Loaded workspaces");

  const label = opts.unhealthy ? "unhealthy" : "stopped";
  const targets = workspaces.filter((ws) =>
    opts.unhealthy ? !ws.health.healthy : workspaceStatus(ws) === "stopped",
  );

  if (targets.length === 0) {
    consola.info(`No ${label} workspaces to prune.`);
    return;
  }

  p.log.info(
    `Found ${pc.bold(String(targets.length))} ${label} workspace${targets.length === 1 ? "" : "s"}:`,
  );
  for (const ws of targets) {
    const age = relativeTime(ws.latest_build.created_at);
    const extra = opts.unhealthy && ws.health.failing_agents.length > 0
      ? `  ${pc.dim("failing agents: " + ws.health.failing_agents.join(", "))}`
      : "";
    p.log.message(`  ${pc.cyan(ws.name)}  ${pc.dim(age + " ago")}${extra}`);
  }

  if (!opts.yes) {
    const confirmed = await p.confirm({
      message: `Delete ${targets.length} ${label} workspace${targets.length === 1 ? "" : "s"}? This cannot be undone.`,
      initialValue: false,
    });
    if (p.isCancel(confirmed) || !confirmed) {
      p.cancel("Cancelled.");
      process.exit(0);
    }
  }

  for (const ws of targets) {
    const layouts = getLayoutsByCoderWorkspace(ws.name);
    for (const layout of layouts) {
      try {
        await cmux.closeWorkspace(layout.cmux_id);
      } catch {}
      removeLayout(layout.name);
    }
  }

  const deleteSpinner = p.spinner();
  deleteSpinner.start(
    `Deleting ${targets.length} workspace${targets.length === 1 ? "" : "s"}`,
  );

  const results = await Promise.allSettled(
    targets.map((ws) => deleteWorkspace(ws.name)),
  );

  let deleted = 0;
  let failed = 0;
  for (const result of results) {
    if (result.status === "fulfilled") deleted++;
    else failed++;
  }

  if (failed > 0) {
    deleteSpinner.stop(`Deleted ${deleted}, ${failed} failed`);
  } else {
    deleteSpinner.stop(`Deleted ${deleted} workspace${deleted === 1 ? "" : "s"}`);
  }

  for (let i = 0; i < results.length; i++) {
    const result = results[i]!;
    if (result.status === "rejected") {
      await printCoderFailure(result.reason, { workspace: targets[i]!.name });
    }
  }

  p.outro(`${pc.green("✓")} Pruned ${deleted} workspace${deleted === 1 ? "" : "s"}`);
}

export const pruneCommand = defineCommand({
  meta: {
    name: "prune",
    description: "Delete all stopped (or --unhealthy) workspaces",
  },
  args: {
    yes: {
      type: "boolean",
      alias: "y",
      description: "Skip confirmation prompt",
      default: false,
    },
    unhealthy: {
      type: "boolean",
      description: "Delete unhealthy workspaces instead of stopped ones",
      default: false,
    },
  },
  async run({ args }) {
    await requireCoderLogin();
    await runPrune({
      yes: args.yes as boolean,
      unhealthy: args.unhealthy as boolean,
    });
  },
});
