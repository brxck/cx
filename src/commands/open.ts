import { defineCommand } from "citty";
import { consola } from "consola";
import * as p from "@clack/prompts";
import pc from "picocolors";
import {
  getCoderUrl,
  dashboardUrl,
  openInBrowser,
  openInVSCode,
  listOpenableApps,
  openWorkspaceApp,
  requireCoderLogin,
  type CoderWorkspace,
} from "../lib/coder.ts";
import { pickWorkspace, pickLayout, fuzzyMatch } from "../lib/workspace-picker.ts";
import * as cmux from "../lib/cmux.ts";
import { getLayoutsByCoderWorkspace } from "../lib/store.ts";

type AppKind = "dashboard" | "vscode" | "external-url" | "command" | "http";
type Destination = "default" | "cmux";
type SplitDir = "left" | "right" | "up" | "down";

interface TaggedApp {
  slug: string;
  label: string;
  kind: AppKind;
  supports: Destination[];
}

function tagApps(ws: CoderWorkspace): TaggedApp[] {
  const apps = listOpenableApps(ws);
  const agents = ws.latest_build.resources.flatMap((r) => r.agents ?? []);
  const rawBySlug = new Map<string, { external?: boolean; command?: string }>();
  for (const agent of agents) {
    for (const app of agent.apps ?? []) {
      rawBySlug.set(app.slug, { external: app.external, command: app.command });
    }
  }

  return apps.map(({ slug, label }) => {
    let kind: AppKind;
    if (slug === "dashboard") {
      kind = "dashboard";
    } else if (slug === "vscode") {
      kind = "vscode";
    } else {
      const raw = rawBySlug.get(slug);
      if (raw?.external) kind = "external-url";
      else if (raw?.command && raw.command.length > 0) kind = "command";
      else kind = "http";
    }
    const supports: Destination[] =
      kind === "dashboard" || kind === "http" ? ["default", "cmux"] : ["default"];
    return { slug, label, kind, supports };
  });
}

function resolveApp(tagged: TaggedApp[], target: string): TaggedApp {
  const exact = tagged.find((a) => a.slug === target);
  if (exact) return exact;
  const fuzzy = tagged.filter(
    (a) => fuzzyMatch(target, a.slug) || fuzzyMatch(target, a.label),
  );
  if (fuzzy.length === 0) {
    consola.error(`No app matching "${target}" on this workspace.`);
    consola.info(`Available: ${tagged.map((a) => a.slug).join(", ")}`);
    process.exit(1);
  }
  if (fuzzy.length > 1) {
    consola.error(
      `Multiple apps match "${target}": ${fuzzy.map((a) => a.slug).join(", ")}`,
    );
    process.exit(1);
  }
  return fuzzy[0]!;
}

function parseSplitDir(raw: string | undefined): SplitDir | undefined {
  if (!raw) return undefined;
  if (raw === "left" || raw === "right" || raw === "up" || raw === "down") return raw;
  consola.error(`Invalid --split value: "${raw}". Expected left, right, up, or down.`);
  process.exit(1);
}

function parseDestination(raw: string | undefined): Destination | undefined {
  if (!raw) return undefined;
  if (raw === "default" || raw === "cmux") return raw;
  consola.error(`Invalid --in value: "${raw}". Expected "default" or "cmux".`);
  process.exit(1);
}

export interface RunOpenOpts {
  ws: CoderWorkspace;
  target?: string;
  in?: string;
  split?: string;
}

export async function runOpen(opts: RunOpenOpts): Promise<void> {
  const { ws } = opts;
  const tagged = tagApps(ws);
  const requestedIn = parseDestination(opts.in);
  const splitDir = parseSplitDir(opts.split);

  let app: TaggedApp;
  if (opts.target) {
    app = resolveApp(tagged, opts.target);
  } else {
    const choice = await p.select({
      message: `Open ${pc.bold(ws.name)}`,
      options: tagged.map((a) => ({ value: a.slug, label: a.label })),
    });
    if (p.isCancel(choice)) process.exit(0);
    app = tagged.find((a) => a.slug === choice)!;
  }

  let destination: Destination;
  if (requestedIn) {
    destination = requestedIn;
    if (!app.supports.includes(destination)) {
      consola.error(
        `${pc.bold(app.label)} (${app.kind}) cannot be opened with --in ${destination}. ` +
          `Supported: ${app.supports.join(", ")}.`,
      );
      process.exit(1);
    }
  } else if (app.supports.length === 1) {
    destination = app.supports[0]!;
  } else {
    const cmuxReachable = await cmux.ping();
    const choice = await p.select<Destination>({
      message: `Open ${pc.bold(app.label)} where?`,
      initialValue: "default",
      options: [
        { value: "default", label: "Default browser" },
        {
          value: "cmux",
          label: cmuxReachable
            ? "Cmux browser surface"
            : "Cmux browser surface (cmux not reachable)",
        },
      ],
    });
    if (p.isCancel(choice)) process.exit(0);
    destination = choice;
  }

  if (splitDir && destination !== "cmux") {
    consola.error("--split can only be used with --in cmux.");
    process.exit(1);
  }

  if (destination === "default") {
    if (app.kind === "dashboard") {
      const baseUrl = await getCoderUrl();
      const url = dashboardUrl(baseUrl, ws.owner_name, ws.name);
      consola.info(`Opening ${pc.bold(ws.name)} in browser...`);
      await openInBrowser(url);
    } else if (app.kind === "vscode") {
      consola.info(`Opening ${pc.bold(ws.name)} in VS Code...`);
      await openInVSCode(ws.name);
    } else {
      consola.info(`Opening ${pc.bold(ws.name)} → ${pc.bold(app.slug)}...`);
      await openWorkspaceApp(ws.name, app.slug);
    }
    return;
  }

  if (!(await cmux.ping())) {
    consola.error(
      "Cmux is not running or unreachable. Launch cmux or re-run with --in default.",
    );
    process.exit(1);
  }

  const baseUrl = await getCoderUrl();
  const dashboard = dashboardUrl(baseUrl, ws.owner_name, ws.name);
  const url = app.kind === "dashboard" ? dashboard : `${dashboard}/apps/${app.slug}/`;

  const layouts = getLayoutsByCoderWorkspace(ws.name);
  let cmuxWs: string | undefined;
  let layoutName: string | undefined;
  if (layouts.length === 1) {
    cmuxWs = layouts[0]!.cmux_id;
    layoutName = layouts[0]!.name;
  } else if (layouts.length > 1) {
    const picked = await pickLayout({ layouts, message: "Select a layout to open into" });
    if (!picked) process.exit(0);
    cmuxWs = picked.cmux_id;
    layoutName = picked.name;
  }

  if (splitDir) {
    await cmux.newSplit({ workspace: cmuxWs, direction: splitDir });
  }

  consola.info(
    `Opening ${pc.bold(app.label)} in cmux${layoutName ? ` → ${pc.bold(layoutName)}` : ""}...`,
  );
  await cmux.newSurface({ workspace: cmuxWs, type: "browser", url });

  try {
    await cmux.notify("cx open", `${app.label} → ${layoutName ?? "cmux"}`);
  } catch {}
}

export const openCommand = defineCommand({
  meta: {
    name: "open",
    description:
      "Open a workspace app (dashboard, VS Code, or any app) in the default browser or a cmux browser surface",
  },
  args: {
    workspace: {
      type: "positional",
      description: "Workspace name (fuzzy matched, or pick interactively)",
      required: false,
    },
    target: {
      type: "string",
      alias: "t",
      description: "App to open (e.g. dashboard, vscode, or any app slug)",
      required: false,
    },
    in: {
      type: "string",
      description: "Where to open: 'default' (OS browser) or 'cmux' (cmux browser surface)",
      required: false,
    },
    split: {
      type: "string",
      description:
        "Before opening in cmux, split the pane: left, right, up, or down (requires --in cmux)",
      required: false,
    },
  },
  async run({ args }) {
    await requireCoderLogin();

    const ws = await pickWorkspace({
      filter: args.workspace as string | undefined,
      message: "Select a workspace to open",
    });

    if (!ws) {
      consola.warn(
        args.workspace
          ? `No workspaces matching "${args.workspace}"`
          : "No workspaces found.",
      );
      process.exit(1);
    }

    await runOpen({
      ws,
      target: args.target as string | undefined,
      in: args.in as string | undefined,
      split: args.split as string | undefined,
    });
  },
});
