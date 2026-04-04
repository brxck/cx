import { defineCommand } from "citty";
import { consola } from "consola";
import * as p from "@clack/prompts";
import pc from "picocolors";
import {
  listWorkspaces as listCoderWorkspaces,
  workspaceStatus,
  createWorkspace,
  startWorkspace,
  waitForWorkspace,
  ensureSshConfig,
  type CoderWorkspace,
} from "../lib/coder.ts";
import * as cmux from "../lib/cmux.ts";
import {
  resolveTemplate as resolveTemplateFromLib,
  generateCmuxCommand,
  writeCmuxJson,
  isSplitNode,
  isPaneNode,
  type TemplateConfig,
  type LayoutNode,
  type PaneNode,
} from "../lib/templates.ts";
import { saveLayout } from "../lib/store.ts";

export const upCommand = defineCommand({
  meta: {
    name: "up",
    description: "Create a Coder workspace and build a Cmux layout",
  },
  args: {
    workspace: {
      type: "positional",
      description: "Coder workspace name",
      required: false,
    },
    template: {
      type: "string",
      alias: "t",
      description: "Template name",
    },
    "no-ports": {
      type: "boolean",
      description: "Skip port forwarding",
      default: false,
    },
  },
  async run({ args }) {
    // 1. Resolve template (project-local → named → interactive picker)
    const resolved = await resolveTemplateFromLib({
      name: args.template as string | undefined,
    });
    if (!resolved) {
      consola.error("No template found. Create one at ~/.config/cmux-coder/templates/ or add a cmux-coder.json to your project.");
      process.exit(1);
    }
    const { template, projectPath } = resolved;

    let coderWsName = args.workspace as string | undefined;
    if (!coderWsName) {
      const name = await p.text({
        message: "Workspace name",
        placeholder: template.name,
        validate: (v) => {
          if (!v?.trim()) return "Name is required";
        },
      });
      if (p.isCancel(name)) {
        p.cancel("Cancelled.");
        process.exit(0);
      }
      coderWsName = name;
    }
    const layoutName = coderWsName;

    p.intro(pc.bold(`cmux-coder up ${pc.cyan(layoutName)}`));

    // 2. Create/start Coder workspace
    await ensureCoderWorkspace(coderWsName, template);

    // 3. Ensure SSH config
    const sshSpinner = p.spinner();
    sshSpinner.start("Updating SSH config");
    await ensureSshConfig();
    sshSpinner.stop("SSH config updated");

    // 4. Build Cmux layout
    const cmuxRef = await buildCmuxLayout(layoutName, template, coderWsName);

    // 5. Port forwarding
    const noPorts = args["no-ports"] as boolean;
    if (!noPorts && template.ports?.length) {
      startPortForwarding(coderWsName, template.ports);
    }

    // 6. Save to store
    saveLayout({
      name: layoutName,
      cmux_id: cmuxRef,
      coder_ws: coderWsName,
      template: template.name,
      type: template.type,
      path: projectPath,
    });

    // 7. Generate cmux.json
    const cmd = generateCmuxCommand(template, coderWsName);
    await writeCmuxJson([cmd]);

    p.outro(
      `${pc.green("✓")} Layout ${pc.bold(layoutName)} is ready — workspace ${pc.cyan(cmuxRef)}`,
    );
  },
});

// ── Coder workspace lifecycle ──

async function ensureCoderWorkspace(
  name: string,
  template: TemplateConfig,
): Promise<void> {
  const spinner = p.spinner();
  spinner.start("Checking Coder workspace");

  const workspaces = await listCoderWorkspaces();
  const existing = workspaces.find((ws) => ws.name === name);

  if (!existing) {
    spinner.stop(`Creating workspace ${pc.bold(name)}`);
    await createWorkspace(name, template.coder.template, {
      params: template.coder.parameters,
      preset: template.coder.preset,
    });
    await waitForWorkspace(name);
    p.log.success(`Workspace ${pc.bold(name)} created and ready`);
    return;
  }

  const status = workspaceStatus(existing);
  if (status === "running") {
    spinner.stop(`Workspace ${pc.bold(name)} is already running`);
    return;
  }

  if (status === "stopped") {
    spinner.stop(`Starting workspace ${pc.bold(name)}`);
    await startWorkspace(name);
    await waitForWorkspace(name);
    p.log.success(`Workspace ${pc.bold(name)} started and ready`);
    return;
  }

  // Starting, stopping, or other — wait for it
  spinner.stop(`Workspace is ${status}, waiting for it to be ready`);
  await waitForWorkspace(name);
  p.log.success(`Workspace ${pc.bold(name)} is ready`);
}

// ── Build Cmux layout ──

async function buildCmuxLayout(
  layoutName: string,
  template: TemplateConfig,
  coderWsName: string,
): Promise<string> {
  const spinner = p.spinner();
  spinner.start("Building Cmux layout");

  const wsRef = await cmux.newWorkspace({ name: layoutName });

  if (template.color) {
    await cmux.setWorkspaceColor(wsRef, template.color);
  }

  // The workspace starts with one pane — the first leaf in the tree uses it
  await walkLayout(template.layout, wsRef, coderWsName, true);

  spinner.stop(`Cmux layout built — ${pc.cyan(wsRef)}`);
  return wsRef;
}

/**
 * Recursively walk the layout tree and create panes/surfaces.
 *
 * `isFirst` indicates whether this node occupies the workspace's initial pane
 * (the first/leftmost leaf doesn't need a new-pane call).
 */
async function walkLayout(
  node: LayoutNode,
  wsRef: string,
  coderWs: string,
  isFirst: boolean,
): Promise<void> {
  if (isPaneNode(node)) {
    await configureSurfaces(node, wsRef, coderWs, isFirst);
    return;
  }

  if (isSplitNode(node)) {
    // First child occupies the current pane space
    await walkLayout(node.children[0], wsRef, coderWs, isFirst);

    // Second child creates a new pane via split
    const direction = node.direction === "horizontal" ? "right" : "down";
    await cmux.newPane({ workspace: wsRef, direction });

    await walkLayout(node.children[1], wsRef, coderWs, true);
  }
}

/**
 * Configure surfaces within a pane. The first terminal surface uses the
 * existing pane; additional surfaces are added as tabs.
 */
async function configureSurfaces(
  node: PaneNode,
  wsRef: string,
  coderWs: string,
  isFirst: boolean,
): Promise<void> {
  const surfaces = node.pane.surfaces;

  for (let i = 0; i < surfaces.length; i++) {
    const surface = surfaces[i]!;
    const isFirstSurface = i === 0 && isFirst;

    if (surface.type === "browser") {
      if (isFirstSurface) {
        // Replace the initial terminal pane with a browser — create a new surface
        // and the initial terminal will be there too. For simplicity, add as new surface.
        await cmux.newSurface({
          workspace: wsRef,
          type: "browser",
          url: surface.url,
        });
      } else {
        await cmux.newSurface({
          workspace: wsRef,
          type: "browser",
          url: surface.url,
        });
      }
    } else {
      // Terminal surface
      const sshCmd = buildSshCommand(coderWs, { session: surface.session, command: surface.command });
      if (isFirstSurface) {
        // Send command to the existing pane's terminal
        await cmux.send(`${sshCmd}\n`, { workspace: wsRef });
      } else {
        // Add a new terminal tab, then send command
        const surfRef = await cmux.newSurface({
          workspace: wsRef,
          type: "terminal",
        });
        await cmux.send(`${sshCmd}\n`, {
          workspace: wsRef,
          surface: surfRef,
        });
      }
    }
  }
}

function buildSshCommand(coderWs: string, opts?: { session?: string; command?: string }): string {
  const host = opts?.session ? `coder.${coderWs}.${opts.session}` : `coder.${coderWs}`;
  const remoteCmd = opts?.command ? ` -t '${opts.command}'` : "";
  return `ssh -R /tmp/cmux.sock:$CMUX_SOCKET_PATH ${host}${remoteCmd}`;
}

// ── Port forwarding ──

function startPortForwarding(coderWsName: string, ports: string[]): void {
  const tcpArgs: string[] = [];
  for (const mapping of ports) {
    tcpArgs.push("--tcp", mapping);
  }

  // Spawn as detached background process
  const proc = Bun.spawn(["coder", "port-forward", coderWsName, ...tcpArgs], {
    stdout: "ignore",
    stderr: "ignore",
    stdin: "ignore",
  });

  // Unref so it doesn't block CLI exit
  proc.unref();

  const summary = ports.join(", ");
  consola.info(`Port forwarding started: ${pc.dim(summary)} (pid ${proc.pid})`);
}
