import { defineCommand } from "citty";
import * as p from "@clack/prompts";
import pc from "picocolors";
import { stopWorkspace, requireCoderLogin } from "../lib/coder.ts";
import * as cmux from "../lib/cmux.ts";
import { getAllLayouts, getLayout, getLayoutsByPath, removeLayout, type LayoutEntry } from "../lib/store.ts";
import { pickLayout } from "../lib/workspace-picker.ts";

export interface RunDownOpts {
  layout: LayoutEntry;
  stop?: boolean;
  keep?: boolean;
}

export async function runDown(opts: RunDownOpts): Promise<void> {
  const { layout } = opts;

  p.intro(pc.bold(`cx down ${pc.cyan(layout.name)}`));

  const shouldStop = await resolveShouldStop(
    layout,
    opts.stop ?? false,
    opts.keep ?? false,
  );

  try {
    await cmux.closeWorkspace(layout.cmux_id);
    p.log.success("Cmux workspace closed");
  } catch {
    p.log.info("Cmux workspace already closed");
  }

  if (shouldStop) {
    p.log.step(`Stopping workspace ${pc.bold(layout.coder_ws)}`);
    await stopWorkspace(layout.coder_ws);
    p.log.success(`Workspace ${pc.bold(layout.coder_ws)} stopped`);
  }

  removeLayout(layout.name);

  p.outro(`${pc.green("✓")} Layout ${pc.bold(layout.name)} torn down`);
}

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
      description: "Also stop the Coder workspace",
      default: false,
    },
    keep: {
      type: "boolean",
      description: "Keep the Coder workspace running",
      default: false,
    },
  },
  async run({ args }) {
    await requireCoderLogin();

    const layout = await resolveLayout(args.layout as string | undefined);
    if (!layout) return;

    await runDown({
      layout,
      stop: args.stop as boolean,
      keep: args.keep as boolean,
    });
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

  const selected = await pickLayout({
    layouts,
    message: "Select a layout to tear down",
  });

  if (!selected) {
    p.cancel("Cancelled.");
    process.exit(0);
  }

  return selected;
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
