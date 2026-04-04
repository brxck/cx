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
} from "../lib/coder.ts";
import {
  getTemplate,
  generateCmuxCommand,
  writeCmuxJson,
  type TemplateConfig,
} from "../lib/templates.ts";
import {
  getAllLayouts,
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
} from "../lib/layout-builder.ts";
import { sshHost } from "../lib/ssh.ts";

export const restoreCommand = defineCommand({
  meta: {
    name: "restore",
    description: "Restore layouts after a restart, reconnecting to live ZMX sessions",
  },
  args: {
    layout: {
      type: "positional",
      required: false,
      description: "Specific layout to restore (default: all)",
    },
    "dry-run": {
      type: "boolean",
      alias: "n",
      description: "Show what would be restored without doing it",
      default: false,
    },
  },
  async run({ args }) {
    const allLayouts = getAllLayouts();
    let layouts = args.layout
      ? allLayouts.filter((l) => l.name === args.layout)
      : allLayouts;

    if (layouts.length === 0) {
      consola.info("No layouts to restore");
      return;
    }

    // Filter out already-active Cmux workspaces
    let cmuxWorkspaces: cmux.CmuxWorkspace[] = [];
    try {
      cmuxWorkspaces = await cmux.listWorkspaces();
    } catch {}
    const activeCmuxRefs = new Set(cmuxWorkspaces.map((w) => w.ref));

    const toRestore: LayoutEntry[] = [];
    const alreadyActive: LayoutEntry[] = [];

    for (const layout of layouts) {
      if (layout.cmux_id === "headless") {
        toRestore.push(layout); // headless layouts need cmux presentation
      } else if (activeCmuxRefs.has(layout.cmux_id)) {
        alreadyActive.push(layout);
      } else {
        toRestore.push(layout);
      }
    }

    // Sort: persistent first, then by last active
    toRestore.sort((a, b) => {
      if (a.type !== b.type) return a.type === "persistent" ? -1 : 1;
      return new Date(b.active_at).getTime() - new Date(a.active_at).getTime();
    });

    if (args["dry-run"]) {
      renderDryRun(toRestore, alreadyActive);
      return;
    }

    p.intro(pc.bold("cmux-coder restore"));

    // Ensure SSH config once
    if (toRestore.length > 0) {
      const sshSpinner = p.spinner();
      sshSpinner.start("Updating SSH config");
      await ensureSshConfig();
      sshSpinner.stop("SSH config updated");
    }

    // Restore each layout sequentially
    const results = { restored: 0, skipped: 0, failed: 0 };

    for (const layout of toRestore) {
      try {
        await restoreLayout(layout);
        results.restored++;
      } catch (err) {
        consola.warn(`Failed to restore ${layout.name}: ${err}`);
        results.failed++;
      }
    }

    p.outro(
      `${results.restored} restored, ${alreadyActive.length} already active, ${results.failed} failed`,
    );
  },
});

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
  const template = layout.template ? await getTemplate(layout.template) : null;

  const effectiveTemplate: TemplateConfig = template ?? {
    name: "default",
    coder: { template: coder.template_name },
    type: layout.type,
    layout: { pane: { surfaces: [{ type: "terminal" }] } },
  };

  if (!template) {
    p.log.warn(`Template "${layout.template}" not found — using default single-pane`);
  }

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
        sessionsToRestart.push({ name: sessionName, command: terminals[i]!.command });
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

  // 10. Regenerate cmux.json entry
  const cmd = await generateCmuxCommand(effectiveTemplate, layout.coder_ws);
  await writeCmuxJson([cmd]);

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

function renderDryRun(toRestore: LayoutEntry[], alreadyActive: LayoutEntry[]): void {
  if (toRestore.length > 0) {
    consola.log(pc.bold("Would restore:"));
    for (const l of toRestore) {
      const sessions = getSessionsForLayout(l.name);
      const sessionInfo = sessions.length > 0 ? `(${sessions.length} sessions)` : "";
      const headless = l.cmux_id === "headless" ? pc.yellow("[headless]") : "";
      consola.log(
        `  ${pc.bold(l.name)}  ${l.coder_ws}  ${pc.dim(l.type)}  ${headless}  ${pc.dim(sessionInfo)}`,
      );
    }
  }
  if (alreadyActive.length > 0) {
    consola.log(pc.bold("\nAlready active:"));
    for (const l of alreadyActive) {
      consola.log(`  ${pc.bold(l.name)}  ${pc.dim(l.cmux_id)}`);
    }
  }
  if (toRestore.length === 0 && alreadyActive.length === 0) {
    consola.info("Nothing to restore");
  }
}
