import { defineCommand } from "citty";
import * as p from "@clack/prompts";
import pc from "picocolors";
import { stopWorkspace } from "../lib/coder.ts";
import * as cmux from "../lib/cmux.ts";
import { removeCmuxJsonEntry } from "../lib/templates.ts";
import { getAllLayouts, getLayout, getLayoutsByPath, removeLayout, type LayoutEntry } from "../lib/store.ts";

export const downCommand = defineCommand({
  meta: {
    name: "down",
    description: "Tear down a Cmux layout and optionally stop the Coder workspace",
  },
  args: {
    layout: {
      type: "positional",
      description: "Layout name",
      required: false,
    },
    stop: {
      type: "boolean",
      description: "Also stop the Coder workspace (skip confirmation)",
      default: false,
    },
    keep: {
      type: "boolean",
      description: "Only remove the layout, keep Coder workspace running (skip confirmation)",
      default: false,
    },
  },
  async run({ args }) {
    // 1. Resolve layout
    const layout = await resolveLayout(args.layout as string | undefined);
    if (!layout) return;

    p.intro(pc.bold(`cmux-coder down ${pc.cyan(layout.name)}`));

    // 2. Determine whether to stop the Coder workspace
    const shouldStop = await resolveShouldStop(
      layout,
      args.stop as boolean,
      args.keep as boolean,
    );

    // 3. Close Cmux workspace
    try {
      await cmux.closeWorkspace(layout.cmux_id);
      p.log.success("Cmux workspace closed");
    } catch {
      p.log.info("Cmux workspace already closed");
    }

    // 4. Stop Coder workspace if requested
    if (shouldStop) {
      p.log.step(`Stopping workspace ${pc.bold(layout.coder_ws)}`);
      await stopWorkspace(layout.coder_ws);
      p.log.success(`Workspace ${pc.bold(layout.coder_ws)} stopped`);
    }

    // 5. Remove from store
    removeLayout(layout.name);

    // 6. Clean up cmux.json
    await removeCmuxJsonEntry(layout.name);

    p.outro(`${pc.green("✓")} Layout ${pc.bold(layout.name)} torn down`);
  },
});

async function resolveLayout(name: string | undefined): Promise<LayoutEntry | null> {
  if (name) {
    const layout = getLayout(name);
    if (!layout) {
      p.log.error(`Layout "${name}" not found`);
      process.exit(1);
    }
    return layout;
  }

  // Try auto-detecting from current directory
  const cwdLayouts = getLayoutsByPath(process.cwd());

  if (cwdLayouts.length === 1) {
    const layout = cwdLayouts[0]!;
    const confirmed = await p.confirm({
      message: `Tear down ${pc.bold(layout.name)}?`,
    });
    if (p.isCancel(confirmed) || !confirmed) {
      p.cancel("Cancelled.");
      process.exit(0);
    }
    return layout;
  }

  // Use cwd-matched layouts if multiple, otherwise all layouts
  const layouts = cwdLayouts.length > 1 ? cwdLayouts : getAllLayouts();
  if (layouts.length === 0) {
    p.log.warn("No active layouts");
    process.exit(0);
  }

  // Join with live cmux workspaces to show status
  let cmuxWorkspaces: cmux.CmuxWorkspace[] = [];
  try {
    cmuxWorkspaces = await cmux.listWorkspaces();
  } catch {}

  const cmuxRefs = new Set(cmuxWorkspaces.map((w) => w.ref));

  const choice = await p.select({
    message: "Select a layout to tear down",
    options: layouts.map((l) => {
      const active = cmuxRefs.has(l.cmux_id);
      const status = active ? pc.green("● active") : pc.dim("○ closed");
      return {
        value: l.name,
        label: `${pc.bold(l.name)}  ${status}  ${pc.dim(l.coder_ws)}  ${pc.dim(l.type)}`,
      };
    }),
  });

  if (p.isCancel(choice)) {
    p.cancel("Cancelled.");
    process.exit(0);
  }

  return layouts.find((l) => l.name === choice) ?? null;
}

async function resolveShouldStop(
  layout: LayoutEntry,
  stopFlag: boolean,
  keepFlag: boolean,
): Promise<boolean> {
  if (stopFlag) return true;
  if (keepFlag) return false;

  const isEphemeral = layout.type === "ephemeral";

  const choice = await p.select({
    message: `${isEphemeral ? "Ephemeral" : "Persistent"} layout — stop Coder workspace?`,
    options: [
      {
        value: isEphemeral,
        label: isEphemeral
          ? `${pc.bold("Stop workspace")} ${pc.dim("(default for ephemeral)")}`
          : `${pc.bold("Keep workspace running")} ${pc.dim("(default for persistent)")}`,
      },
      {
        value: !isEphemeral,
        label: isEphemeral
          ? "Keep workspace running"
          : "Stop workspace",
      },
    ],
  });

  if (p.isCancel(choice)) {
    p.cancel("Cancelled.");
    process.exit(0);
  }

  return choice as boolean;
}
