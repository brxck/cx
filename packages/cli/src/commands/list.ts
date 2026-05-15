import { defineCommand } from "citty";
import { consola } from "consola";
import * as p from "@clack/prompts";
import pc from "picocolors";
import {
  getCoderUrl,
  dashboardUrl,
  workspaceStatus,
  isStaleStoppedWorkspace,
  requireCoderLogin,
  type CoderWorkspace,
} from "../lib/coder.ts";
import { loadWorkspaces } from "../lib/workspace-cache.ts";
import { listWorkspaces as listCmuxWorkspaces } from "../lib/cmux.ts";
import { formatWorkspaceLabel, fuzzyMatch, REFRESH_SENTINEL } from "../lib/workspace-picker.ts";
import { getLayoutsByCoderWorkspace, type LayoutEntry } from "../lib/store.ts";
import {
  WORKSPACE_ACTIONS,
  buildActionOptions,
} from "../lib/workspace-actions.ts";

const FIELD_WIDTH = 10;

function field(label: string): string {
  return pc.dim(label.padEnd(FIELD_WIDTH));
}

async function printWorkspaceSummary(
  ws: CoderWorkspace,
  layouts: LayoutEntry[],
  coderBaseUrl: string,
): Promise<void> {
  const lines: string[] = [];
  lines.push(formatWorkspaceLabel(ws));
  lines.push(field("Dashboard") + pc.dim(dashboardUrl(coderBaseUrl, ws.owner_name, ws.name)));

  if (ws.outdated) {
    lines.push(field("Template") + pc.yellow("⚠ outdated"));
  }

  if (layouts.length > 0) {
    let activeRefs: Set<string> | null = null;
    try {
      const cmuxWs = await listCmuxWorkspaces();
      activeRefs = new Set(cmuxWs.map((w) => w.ref));
    } catch {}
    const parts = layouts.map((l) => {
      if (!activeRefs) return l.name;
      return activeRefs.has(l.cmux_id) ? `${pc.green("●")} ${l.name}` : `${pc.dim("○ " + l.name)}`;
    });
    lines.push(field("Layouts") + parts.join("  "));
  }

  const agents = ws.latest_build.resources.flatMap((r) => r.agents ?? []);
  if (agents.length > 0) {
    const parts = agents.map((a) => {
      const ready = a.status === "connected" && a.lifecycle_state === "ready";
      const state = ready ? pc.green("ready") : pc.yellow(a.lifecycle_state);
      return `${a.name} ${pc.dim("(" + a.status + ", ")}${state}${pc.dim(")")}`;
    });
    lines.push(field("Agents") + parts.join("  "));
  }

  consola.log("");
  for (const line of lines) consola.log(line);
  consola.log("");
}

export const listCommand = defineCommand({
  meta: {
    name: "list",
    description: "List and interact with your Coder workspaces",
  },
  args: {
    filter: {
      type: "positional",
      description: "Fuzzy filter string for workspace names",
      required: false,
    },
    interactive: {
      type: "boolean",
      description: "Enable interactive selection",
      default: true,
    },
    all: {
      type: "boolean",
      alias: "a",
      description: "Show all workspaces including stale stopped ones",
      default: false,
    },
  },
  async run({ args }) {
    await requireCoderLogin();

    const { cached, fresh } = loadWorkspaces();
    const coderBaseUrlP = getCoderUrl();

    let workspaces: CoderWorkspace[];
    let usedCache = false;

    if (cached && cached.workspaces.length > 0) {
      workspaces = cached.workspaces;
      usedCache = true;
      fresh.then((list) => { workspaces = list; }).catch(() => {});
    } else {
      const spinner = p.spinner();
      spinner.start("Fetching workspaces");
      try {
        workspaces = await fresh;
      } catch (e) {
        spinner.stop("Failed to fetch workspaces");
        consola.error(
          "Could not reach Coder. Make sure `coder` is installed and you are logged in.",
        );
        process.exit(1);
      }
      spinner.stop(`Found ${workspaces.length} workspace${workspaces.length === 1 ? "" : "s"}`);
    }

    let coderBaseUrl: string;
    try {
      coderBaseUrl = await coderBaseUrlP;
    } catch (e) {
      consola.error(
        "Could not reach Coder. Make sure `coder` is installed and you are logged in.",
      );
      process.exit(1);
    }

    if (workspaces.length === 0) {
      consola.info("No workspaces found.");
      return;
    }

    const filterArg = args.filter as string | undefined;
    const matchesFilter = (ws: CoderWorkspace): boolean =>
      !filterArg || fuzzyMatch(filterArg, ws.name);

    const showAll = args.all as boolean;
    const sortAndFilter = (list: CoderWorkspace[]): CoderWorkspace[] =>
      list
        .filter(matchesFilter)
        .filter((ws) => showAll || !isStaleStoppedWorkspace(ws))
        .sort((a, b) => {
          const aRunning = workspaceStatus(a) === "running" ? 0 : 1;
          const bRunning = workspaceStatus(b) === "running" ? 0 : 1;
          if (aRunning !== bRunning) return aRunning - bRunning;
          return a.name.localeCompare(b.name);
        });

    const initialFiltered = sortAndFilter(workspaces);
    if (initialFiltered.length === 0) {
      if (filterArg) {
        consola.warn(`No workspaces matching "${filterArg}"`);
      } else {
        consola.info("No workspaces found.");
      }
      return;
    }

    // Non-interactive: just print and exit
    if (!args.interactive) {
      for (const ws of initialFiltered) {
        consola.log(formatWorkspaceLabel(ws));
      }
      return;
    }

    const message = usedCache
      ? `Select a workspace ${pc.dim("• refreshing…")}`
      : "Select a workspace";

    const selected = await p.autocomplete({
      message,
      options: () => {
        const rows = sortAndFilter(workspaces).map((ws) => ({
          value: ws.name,
          label: formatWorkspaceLabel(ws),
        }));
        rows.push({ value: REFRESH_SENTINEL, label: pc.dim("↻ Refresh list") });
        return rows;
      },
      placeholder: "Type to filter",
    });

    if (p.isCancel(selected)) {
      p.cancel("Cancelled.");
      process.exit(0);
    }

    const live = await fresh.catch(() => workspaces);

    let ws: CoderWorkspace | undefined;
    if (selected === REFRESH_SENTINEL) {
      ws = undefined;
    } else {
      ws = live.find((w) => w.name === selected);
      if (!ws) {
        p.log.warn(`Workspace ${pc.bold(selected as string)} no longer exists.`);
      }
    }

    if (!ws) {
      const remaining = sortAndFilter(live);
      if (remaining.length === 0) {
        consola.info("No workspaces found.");
        return;
      }
      const reChoice = await p.autocomplete({
        message: "Select a workspace",
        options: remaining.map((w) => ({
          value: w.name,
          label: formatWorkspaceLabel(w),
        })),
        placeholder: "Type to filter",
      });
      if (p.isCancel(reChoice)) {
        p.cancel("Cancelled.");
        process.exit(0);
      }
      ws = remaining.find((w) => w.name === reChoice)!;
    }

    const layouts = getLayoutsByCoderWorkspace(ws.name);
    const available = WORKSPACE_ACTIONS.filter((a) => a.isAvailable({ ws: ws!, layouts }));
    const ctx = { ws, layouts, coderBaseUrl };
    const options = buildActionOptions(available, ctx);

    await printWorkspaceSummary(ws, layouts, coderBaseUrl);

    const choice = await p.autocomplete({
      message: `Action for ${pc.bold(ws.name)}`,
      options,
      placeholder: "Type to filter",
    });

    if (p.isCancel(choice)) {
      p.cancel("Cancelled.");
      process.exit(0);
    }

    const action = available.find((a) => a.id === choice);
    if (!action) {
      consola.error(`Unknown action: ${choice}`);
      process.exit(1);
    }
    await action.run(ctx);
  },
});
