import { defineCommand } from "citty";
import { consola } from "consola";
import pc from "picocolors";
import * as cmux from "../lib/cmux.ts";
import { parseSidebarState, sidebarState } from "../lib/cmux.ts";
import {
  getAllLayouts,
  findLayoutsByBranch,
  getLayoutsByPath,
  touchLayout,
  type LayoutEntry,
} from "../lib/store.ts";
import { fuzzyMatch, pickLayout } from "../lib/workspace-picker.ts";

export const findCommand = defineCommand({
  meta: {
    name: "find",
    description: "Search layouts by name, branch, path, or fuzzy query",
  },
  args: {
    query: {
      type: "positional",
      description: "Search query",
      required: false,
    },
    branch: {
      type: "string",
      alias: "b",
      description: "Search by git branch",
    },
    path: {
      type: "string",
      alias: "p",
      description: "Search by project path",
    },
  },
  async run({ args }) {
    const query = args.query as string | undefined;
    const branch = args.branch as string | undefined;
    const path = args.path as string | undefined;

    let results: LayoutEntry[];

    if (branch) {
      results = await findByBranch(branch);
    } else if (path) {
      results = getLayoutsByPath(path);
    } else if (query) {
      results = fuzzySearch(query);
    } else {
      // No args — show all layouts
      const selected = await pickLayout({ message: "Select a layout to activate" });
      if (!selected) {
        consola.info("No layouts found");
        return;
      }
      await activateResult(selected);
      return;
    }

    const searchDesc = branch ? `branch "${branch}"` : path ? `path "${path}"` : `"${query}"`;

    if (results.length === 0) {
      consola.info(`No layouts matching ${searchDesc}`);
      return;
    }

    let selected: LayoutEntry | null;
    if (results.length === 1) {
      selected = results[0]!;
      consola.info(`Found: ${pc.bold(selected.name)}`);
    } else {
      selected = await pickLayout({
        layouts: results,
        message: `${results.length} layouts matching ${searchDesc}`,
      });
    }

    if (!selected) return;
    await activateResult(selected);
  },
});

function fuzzySearch(query: string): LayoutEntry[] {
  const all = getAllLayouts();
  return all.filter((layout) =>
    [layout.name, layout.coder_ws, layout.template, layout.branch, layout.path]
      .filter(Boolean)
      .some((field) => fuzzyMatch(query, field!)),
  );
}

async function findByBranch(query: string): Promise<LayoutEntry[]> {
  // Get matches from store
  const storeMatches = findLayoutsByBranch(query);
  const matchedNames = new Set(storeMatches.map((l) => l.name));

  // For active layouts not already matched, check live sidebar state
  const all = getAllLayouts();
  let cmuxWorkspaces: cmux.CmuxWorkspace[] = [];
  try {
    cmuxWorkspaces = await cmux.listWorkspaces();
  } catch {
    return storeMatches;
  }

  const cmuxRefs = new Set(cmuxWorkspaces.map((w) => w.ref));
  const activeUnmatched = all.filter(
    (l) => cmuxRefs.has(l.cmux_id) && !matchedNames.has(l.name),
  );

  const liveMatches = await Promise.all(
    activeUnmatched.map(async (layout) => {
      try {
        const output = await sidebarState(layout.cmux_id);
        const state = parseSidebarState(output);
        if (state.gitBranch && fuzzyMatch(query, state.gitBranch)) {
          return layout;
        }
      } catch {}
      return null;
    }),
  );

  return [...storeMatches, ...liveMatches.filter(Boolean)] as LayoutEntry[];
}

async function activateResult(layout: LayoutEntry): Promise<void> {
  try {
    await cmux.selectWorkspace(layout.cmux_id);
    touchLayout(layout.name);
    consola.success(`Switched to ${pc.bold(layout.name)}`);
  } catch {
    consola.warn(
      `Layout ${pc.bold(layout.name)} is not active in Cmux. Use ${pc.cyan("up")} to recreate it.`,
    );
  }
}
