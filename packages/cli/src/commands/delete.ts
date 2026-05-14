import { defineCommand } from "citty";
import * as p from "@clack/prompts";
import pc from "picocolors";
import consola from "consola";
import {
  deleteWorkspace,
  requireCoderLogin,
  type CoderWorkspace,
} from "../lib/coder.ts";
import { loadWorkspaces } from "../lib/workspace-cache.ts";
import { formatLogForSpinner, printCoderFailure } from "../lib/coder-ui.ts";
import * as cmux from "../lib/cmux.ts";
import {
  getLayoutsByCoderWorkspace,
  removeLayout,
  type LayoutEntry,
} from "../lib/store.ts";
import { pickWorkspace } from "../lib/workspace-picker.ts";

export interface RunDeleteOpts {
  ws: CoderWorkspace;
  layouts?: LayoutEntry[];
  orphan?: boolean;
  /** Skip interactive confirmation. */
  yes?: boolean;
}

export async function runDelete(opts: RunDeleteOpts): Promise<void> {
  const { ws } = opts;
  const layouts = opts.layouts ?? getLayoutsByCoderWorkspace(ws.name);

  p.intro(pc.bold(`cx delete ${pc.cyan(ws.name)}`));

  if (!opts.yes) {
    if (layouts.length > 0) {
      const names = layouts.map((l) => pc.bold(l.name)).join(", ");
      p.log.warn(
        `Layout${layouts.length === 1 ? "" : "s"} ${names} will also be torn down.`,
      );
    }
    const confirmed = await p.confirm({
      message: `Permanently delete ${pc.bold(ws.name)}? This cannot be undone.`,
      initialValue: false,
    });
    if (p.isCancel(confirmed) || !confirmed) {
      p.cancel("Cancelled.");
      process.exit(0);
    }
  }

  for (const layout of layouts) {
    try {
      await cmux.closeWorkspace(layout.cmux_id);
    } catch {}
    removeLayout(layout.name);
  }
  if (layouts.length > 0) {
    p.log.success(
      `Removed ${layouts.length} layout${layouts.length === 1 ? "" : "s"}`,
    );
  }

  const spinner = p.spinner();
  const heading = `Deleting ${pc.cyan(ws.name)}`;
  spinner.start(heading);
  try {
    await deleteWorkspace(ws.name, {
      orphan: opts.orphan,
      onLine: (line) => spinner.message(formatLogForSpinner(heading, line)),
    });
    spinner.stop(`${pc.cyan(ws.name)} deleted`);
  } catch (err) {
    spinner.error(`Failed to delete ${pc.cyan(ws.name)}`);
    await printCoderFailure(err, { workspace: ws.name });
    throw err;
  }

  p.outro(`${pc.green("✓")} Workspace ${pc.bold(ws.name)} deleted`);
}

export const deleteCommand = defineCommand({
  meta: {
    name: "delete",
    description: "Delete a Coder workspace and its layouts",
  },
  args: {
    workspace: {
      type: "positional",
      required: false,
      description: "Workspace to delete",
    },
    orphan: {
      type: "boolean",
      description: "Delete without cleaning up cloud resources",
      default: false,
    },
    yes: {
      type: "boolean",
      description: "Skip confirmation prompt",
      default: false,
    },
  },
  async run({ args }) {
    await requireCoderLogin();

    const wsName = args.workspace as string | undefined;
    let ws: CoderWorkspace | null;
    if (wsName) {
      const { fresh } = loadWorkspaces();
      const live = await fresh;
      ws = live.find((w) => w.name === wsName) ?? null;
      if (!ws) {
        consola.error(`Workspace "${wsName}" not found`);
        process.exit(1);
      }
    } else {
      ws = await pickWorkspace({ message: "Select a workspace to delete", showStopped: true });
      if (!ws) {
        p.cancel("Cancelled.");
        process.exit(0);
      }
    }

    await runDelete({
      ws,
      orphan: args.orphan as boolean,
      yes: args.yes as boolean,
    });
  },
});
