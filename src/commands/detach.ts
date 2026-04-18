import { defineCommand } from "citty";
import * as p from "@clack/prompts";
import pc from "picocolors";
import * as cmux from "../lib/cmux.ts";
import { getLayout, getLayoutsByPath, getAllLayouts, removeLayout, type LayoutEntry } from "../lib/store.ts";
import { pickLayout } from "../lib/workspace-picker.ts";

export interface RunDetachOpts {
  layout: LayoutEntry;
}

export async function runDetach(opts: RunDetachOpts): Promise<void> {
  const { layout } = opts;

  p.intro(pc.bold(`cx detach ${pc.cyan(layout.name)}`));

  try {
    await cmux.closeWorkspace(layout.cmux_id);
    p.log.success("Cmux workspace closed");
  } catch {
    p.log.info("Cmux workspace already closed");
  }

  removeLayout(layout.name);

  p.outro(
    `${pc.green("✓")} Layout ${pc.bold(layout.name)} detached — workspace ${pc.cyan(layout.coder_ws)} is still running`,
  );
}

export const detachCommand = defineCommand({
  meta: {
    name: "detach",
    description: "Remove a Cmux layout but keep the Coder workspace running",
  },
  args: {
    layout: {
      type: "positional",
      description: "Layout name",
      required: false,
    },
  },
  async run({ args }) {
    const layout = await resolveLayout(args.layout as string | undefined);
    if (!layout) return;

    await runDetach({ layout });
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
    return cwdLayouts[0]!;
  }

  // Use cwd-matched layouts if multiple, otherwise all layouts
  const layouts = cwdLayouts.length > 1 ? cwdLayouts : getAllLayouts();
  if (layouts.length === 0) {
    p.log.warn("No active layouts");
    process.exit(0);
  }

  const selected = await pickLayout({
    layouts,
    message: "Select a layout to detach",
  });

  if (!selected) {
    p.cancel("Cancelled.");
    process.exit(0);
  }

  return selected;
}
