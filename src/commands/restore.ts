import { defineCommand } from "citty";
import { consola } from "consola";
import * as p from "@clack/prompts";
import pc from "picocolors";
import * as cmux from "../lib/cmux.ts";
import {
  listWorkspaces as listCoderWorkspaces,
  workspaceStatus,
  startWorkspace,
  waitForWorkspace,
  ensureSshConfig,
  requireCoderLogin,
  buildWorkspaceContext,
  getCoderUrl,
} from "../lib/coder.ts";
import {
  getTemplateSource,
  materializeTemplate,
  normalizeCommand,
  type TemplateConfig,
  type TemplateSource,
} from "../lib/templates.ts";
import {
  getAllLayouts,
  getLayout,
  getSessionsForLayout,
  recordSession,
  updateLayout,
  touchLayout,
  type LayoutEntry,
} from "../lib/store.ts";
import {
  buildCmuxLayout,
  collectTerminalSurfaces,
  startPortForwarding,
  stripCommands,
} from "../lib/layout-builder.ts";
import { sshHost } from "../lib/ssh.ts";
import { fuzzyMatch, pickLayout } from "../lib/workspace-picker.ts";

export const restoreCommand = defineCommand({
  meta: {
    name: "restore",
    description: "Restore layouts after a restart, reconnecting to live ZMX sessions",
  },
  args: {
    layout: {
      type: "positional",
      required: false,
      description: "Layout to restore",
    },
    "dry-run": {
      type: "boolean",
      alias: "n",
      description: "Show what would be restored without doing it",
      default: false,
    },
  },
  async run({ args }) {
    await requireCoderLogin();

    let cmuxWorkspaces: cmux.CmuxWorkspace[] = [];
    try {
      cmuxWorkspaces = await cmux.listWorkspaces();
    } catch {}
    const activeRefs = new Set(cmuxWorkspaces.map((w) => w.ref));

    const isRestorable = (l: LayoutEntry): boolean =>
      l.cmux_id === "headless" || !activeRefs.has(l.cmux_id);

    const layout = await resolveLayout(args.layout as string | undefined, isRestorable);
    if (!layout) return;

    if (args["dry-run"]) {
      renderDryRun(layout);
      return;
    }

    p.intro(pc.bold(`cx restore ${pc.cyan(layout.name)}`));

    const sshSpinner = p.spinner();
    sshSpinner.start("Updating SSH config");
    await ensureSshConfig();
    sshSpinner.stop("SSH config updated");

    await restoreLayout(layout);

    p.outro(`${pc.green("✓")} Restored ${pc.bold(layout.name)}`);
  },
});

async function resolveLayout(
  name: string | undefined,
  isRestorable: (l: LayoutEntry) => boolean,
): Promise<LayoutEntry | null> {
  if (name) {
    const exact = getLayout(name);
    if (exact) {
      if (!isRestorable(exact)) {
        consola.error(
          `Layout ${pc.bold(exact.name)} is already active. Use ${pc.cyan(`cx activate ${exact.name}`)} to switch to it.`,
        );
        process.exit(1);
      }
      return exact;
    }

    const all = getAllLayouts();
    const matches = all.filter((l) => fuzzyMatch(name, l.name));
    if (matches.length === 1) {
      const match = matches[0]!;
      if (!isRestorable(match)) {
        consola.error(
          `Layout ${pc.bold(match.name)} is already active. Use ${pc.cyan(`cx activate ${match.name}`)} to switch to it.`,
        );
        process.exit(1);
      }
      return match;
    }
    if (matches.length > 1) {
      const restorable = matches.filter(isRestorable);
      if (restorable.length === 0) {
        consola.error(`All layouts matching "${name}" are already active.`);
        process.exit(1);
      }
      return pickLayout({ layouts: restorable, message: `Multiple matches for "${name}"` });
    }

    consola.error(`Layout "${name}" not found`);
    process.exit(1);
  }

  const restorable = getAllLayouts().filter(isRestorable);
  if (restorable.length === 0) {
    consola.info("No layouts to restore");
    return null;
  }

  const selected = await pickLayout({ layouts: restorable, message: "Select a layout to restore" });
  if (!selected) {
    consola.info("Cancelled");
    process.exit(0);
  }
  return selected;
}

async function restoreLayout(layout: LayoutEntry): Promise<void> {
  const spinner = p.spinner();
  spinner.start(`Restoring ${pc.bold(layout.name)}`);

  // 1. Ensure Coder workspace is running
  const coderWorkspaces = await listCoderWorkspaces();
  const coder = coderWorkspaces.find((w) => w.name === layout.coder_ws);

  if (!coder) {
    spinner.stop(`Coder workspace ${pc.bold(layout.coder_ws)} not found — skipping`);
    return;
  }

  const status = workspaceStatus(coder);
  if (status === "stopped") {
    spinner.message(`Starting ${layout.coder_ws}`);
    await startWorkspace(layout.coder_ws);
    await waitForWorkspace(layout.coder_ws);
  } else if (status !== "running") {
    spinner.message(`Waiting for ${layout.coder_ws} (${status})`);
    await waitForWorkspace(layout.coder_ws);
  }

  // 2. Resolve template
  const source = layout.template ? await getTemplateSource(layout.template) : null;

  const fallbackConfig: TemplateConfig = {
    name: "default",
    coder: { template: coder.template_name },
    type: layout.type,
    layout: { pane: { surfaces: [{ type: "terminal" }] } },
  };

  const effectiveSource: TemplateSource = source ?? {
    kind: "json",
    name: "default",
    filePath: "<default>",
    config: fallbackConfig,
  };

  if (!source && layout.template) {
    p.log.warn(`Template "${layout.template}" not found — using default single-pane`);
  }

  const persistedVars = layout.vars ? (JSON.parse(layout.vars) as Record<string, unknown>) : undefined;

  // Restore never prompts and never re-runs commands — rebuild the layout shape
  // from persisted state, then strip commands so existing ZMX sessions are reattached
  // without re-executing their original commands.
  const { template: effectiveTemplate } = await materializeTemplate(effectiveSource, {
    persistedVars,
    interactive: false,
    workspaceFactory: async () => buildWorkspaceContext(coder, await getCoderUrl()),
  });
  stripCommands(effectiveTemplate.layout);

  // 3. Probe remote for live ZMX sessions
  const storedSessions = getSessionsForLayout(layout.name);
  const liveSessionNames = await probeLiveSessions(layout.coder_ws);

  // 4. Inject session names into template — reuse stored sessions where alive, restart dead ones
  const terminals = collectTerminalSurfaces(effectiveTemplate.layout);
  const sessionsToRestart: Array<{ name: string; command?: string }> = [];

  for (let i = 0; i < terminals.length; i++) {
    const sessionName = storedSessions[i] ?? terminals[i]!.session;
    if (sessionName) {
      terminals[i]!.session = sessionName;
      if (!liveSessionNames.has(sessionName)) {
        sessionsToRestart.push({ name: sessionName, command: normalizeCommand(terminals[i]!.command) });
      }
    }
  }

  // 5. Restart dead sessions
  for (const s of sessionsToRestart) {
    const cmd = s.command ?? "bash";
    const host = await sshHost(layout.coder_ws);
    await Bun.$`ssh ${host} -- zmx run ${s.name} ${cmd}`.quiet();
  }

  // 6. Build Cmux layout (connects to existing/restarted sessions)
  const { cmuxRef, sessions } = await buildCmuxLayout(
    layout.name,
    effectiveTemplate,
    layout.coder_ws,
  );

  // 7. Record any new sessions
  for (const session of sessions) {
    recordSession(layout.coder_ws, session.name, layout.name);
  }

  // 8. Update store with new Cmux ref
  updateLayout(layout.name, { cmux_id: cmuxRef });
  touchLayout(layout.name);

  // 9. Port forwarding
  if (effectiveTemplate.ports?.length) {
    startPortForwarding(layout.coder_ws, effectiveTemplate.ports);
  }

  spinner.stop(`Restored ${pc.bold(layout.name)} — ${pc.cyan(cmuxRef)}`);
}

async function probeLiveSessions(coderWs: string): Promise<Set<string>> {
  try {
    const host = await sshHost(coderWs);
    const output = await Bun.$`ssh ${host} -- zmx list --short`.quiet().text();
    const names = output.trim().split("\n").filter(Boolean);
    return new Set(names);
  } catch {
    return new Set();
  }
}

function renderDryRun(layout: LayoutEntry): void {
  const sessions = getSessionsForLayout(layout.name);
  const sessionInfo = sessions.length > 0 ? `(${sessions.length} sessions)` : "";
  const headless = layout.cmux_id === "headless" ? pc.yellow("[headless]") : "";
  consola.log(pc.bold("Would restore:"));
  consola.log(
    `  ${pc.bold(layout.name)}  ${layout.coder_ws}  ${pc.dim(layout.type)}  ${headless}  ${pc.dim(sessionInfo)}`,
  );
}
