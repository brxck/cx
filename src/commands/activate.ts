import { defineCommand } from "citty";
import { consola } from "consola";
import pc from "picocolors";
import * as cmux from "../lib/cmux.ts";
import { getAllLayouts, getLayout, touchLayout, updateLayout, type LayoutEntry } from "../lib/store.ts";
import { fuzzyMatch, pickLayout } from "../lib/workspace-picker.ts";

export const activateCommand = defineCommand({
  meta: {
    name: "activate",
    description: "Switch to a layout's Cmux workspace",
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

    try {
      await cmux.selectWorkspace(layout.cmux_id);
    } catch {
      consola.error(
        `Layout ${pc.bold(layout.name)} is not active in Cmux. Use ${pc.cyan("up")} to recreate it.`,
      );
      process.exit(1);
    }

    touchLayout(layout.name);

    // Opportunistically persist branch from sidebar
    try {
      const output = await cmux.sidebarState(layout.cmux_id);
      const sidebar = cmux.parseSidebarState(output);
      if (sidebar.gitBranch) {
        updateLayout(layout.name, { branch: sidebar.gitBranch });
      }
    } catch {}

    consola.success(`Switched to ${pc.bold(layout.name)}`);
  },
});

async function resolveLayout(name: string | undefined): Promise<LayoutEntry | null> {
  if (name) {
    // Try exact match first
    const exact = getLayout(name);
    if (exact) return exact;

    // Try fuzzy match
    const all = getAllLayouts();
    const matches = all.filter((l) => fuzzyMatch(name, l.name));
    if (matches.length === 1) return matches[0]!;
    if (matches.length > 1) {
      return pickLayout({ layouts: matches, message: `Multiple matches for "${name}"` });
    }

    consola.error(`Layout "${name}" not found`);
    process.exit(1);
  }

  // No arg — interactive picker
  const selected = await pickLayout({ message: "Select a layout to activate" });
  if (!selected) {
    consola.info("No layouts found");
    process.exit(0);
  }
  return selected;
}
