import * as p from "@clack/prompts";
import pc from "picocolors";
import * as cmux from "./cmux.ts";
import {
  isSplitNode,
  isPaneNode,
  normalizeCommand,
  type TemplateConfig,
  type LayoutNode,
  type PaneNode,
  type SurfaceConfig,
} from "./templates.ts";
import { consola } from "consola";
import { buildInteractiveSshCommand, sshHost, sshHostWithSession } from "./ssh.ts";
import { loadConfig } from "./config.ts";

export interface BuiltLayout {
  cmuxRef: string;
  sessions: Array<{ name: string; command?: string }>;
}

interface SshContext {
  useCmuxSsh: boolean;
  host: string;
}

async function interactiveSshForSession(coderWs: string, session: string): Promise<string> {
  return buildInteractiveSshCommand(await sshHostWithSession(coderWs, session));
}

/**
 * Create a Cmux SSH workspace and populate it by walking the template's layout tree.
 * The SSH surface is the first terminal pane with a managed connection.
 * Browser panes auto-proxy through the relay daemon's SOCKS5 proxy.
 * Secondary terminals are local panes with SSH commands.
 */
export async function buildCmuxLayout(
  layoutName: string,
  template: TemplateConfig,
  coderWsName: string,
): Promise<BuiltLayout> {
  const spinner = p.spinner();
  spinner.start("Building layout");

  validateSessionNames(template.layout);

  const host = await sshHost(coderWsName);
  const config = await loadConfig();
  const useCmuxSsh = config.cmuxSsh !== false;
  const sshCtx: SshContext = { useCmuxSsh, host };

  let wsRef: string;
  if (useCmuxSsh) {
    wsRef = (await cmux.ssh(host, { name: layoutName })).workspace;
  } else {
    const initialSession = collectTerminalSurfaces(template.layout)[0]?.session;
    if (initialSession) {
      const initialCmd = await interactiveSshForSession(coderWsName, initialSession);
      wsRef = await cmux.newWorkspace({ name: layoutName, command: initialCmd });
    } else {
      wsRef = await cmux.newWorkspace({ name: layoutName });
    }
  }

  if (template.color) {
    await cmux.setWorkspaceColor(wsRef, template.color);
  }

  // Resolve the initial surface (the single surface of the single pane).
  const panes = await cmux.listPanes(wsRef);
  const initialSurfRef = panes[0]?.surface_refs[0];
  if (!initialSurfRef) {
    throw new Error(`New workspace ${wsRef} has no initial surface`);
  }

  if (!useCmuxSsh) {
    await cmux.waitForPrompt(wsRef, initialSurfRef);
  }

  const sessions: Array<{ name: string; command?: string }> = [];
  await walkLayout(template.layout, wsRef, coderWsName, initialSurfRef, sessions, sshCtx);

  spinner.stop(`Layout built — ${pc.cyan(wsRef)}`);
  return { cmuxRef: wsRef, sessions };
}

/**
 * Start ZMX sessions on the remote without creating a Cmux layout.
 */
export async function startHeadlessSessions(
  template: TemplateConfig,
  coderWsName: string,
): Promise<Array<{ name: string; command?: string }>> {
  const spinner = p.spinner();
  spinner.start("Starting headless ZMX sessions");

  validateSessionNames(template.layout);

  const surfaces = collectTerminalSurfaces(template.layout);
  const sessions: Array<{ name: string; command?: string }> = [];

  for (const surface of surfaces) {
    const sessionName = surface.session!;
    const command = normalizeCommand(surface.command, surface.cwd) ?? "";
    const host = await sshHost(coderWsName);
    await Bun.$`ssh -n ${host} -- zmx run ${sessionName} ${command}`.quiet();
    sessions.push({ name: sessionName, command });
  }

  spinner.stop(`${sessions.length} ZMX sessions started`);
  return sessions;
}

/** Remove command/cwd from every terminal surface in a layout tree. Mutates in place. */
export function stripCommands(node: LayoutNode): void {
  if (isPaneNode(node)) {
    for (const surface of node.pane.surfaces) {
      if (surface.type === "terminal") {
        delete surface.command;
        delete surface.cwd;
      }
    }
  } else if (isSplitNode(node)) {
    stripCommands(node.children[0]);
    stripCommands(node.children[1]);
  }
}

/** Collect all terminal surfaces from a layout tree. */
export function collectTerminalSurfaces(node: LayoutNode): SurfaceConfig[] {
  if (isPaneNode(node)) {
    return node.pane.surfaces.filter((s) => s.type === "terminal");
  }
  if (isSplitNode(node)) {
    return [
      ...collectTerminalSurfaces(node.children[0]),
      ...collectTerminalSurfaces(node.children[1]),
    ];
  }
  return [];
}

/**
 * Ensure every terminal surface in a layout tree has a `session` name.
 * Throws a descriptive error if any are missing.
 */
export function validateSessionNames(node: LayoutNode): void {
  for (const surface of collectTerminalSurfaces(node)) {
    if (!surface.session) {
      throw new Error("Every terminal surface in a template must specify `session`.");
    }
  }
}

/**
 * Spawn a detached `coder port-forward` process for the given workspace.
 */
export function startPortForwarding(coderWsName: string, ports: string[]): void {
  const tcpArgs: string[] = [];
  for (const mapping of ports) {
    tcpArgs.push("--tcp", mapping);
  }

  const proc = Bun.spawn(["coder", "port-forward", coderWsName, ...tcpArgs], {
    stdout: "ignore",
    stderr: "ignore",
    stdin: "ignore",
  });

  proc.unref();

  const summary = ports.join(", ");
  consola.info(`Port forwarding started: ${pc.dim(summary)} (pid ${proc.pid})`);
}

// ── Internal helpers ──

async function walkLayout(
  node: LayoutNode,
  wsRef: string,
  coderWs: string,
  surfRef: string,
  sessions: Array<{ name: string; command?: string }>,
  sshCtx: SshContext,
): Promise<void> {
  if (isPaneNode(node)) {
    await configureSurfaces(node, wsRef, surfRef, sessions, sshCtx, coderWs);
    return;
  }

  if (isSplitNode(node)) {
    // Split the anchor pane first so nested splits inherit the right geometry,
    // instead of operating on whatever pane happens to be focused.
    const direction = node.direction === "horizontal" ? "right" : "down";
    const newSurfRef = await cmux.newSplit({
      workspace: wsRef,
      surface: surfRef,
      direction,
    });

    if (!sshCtx.useCmuxSsh) {
      // Only SSH if the right subtree actually has a terminal surface that
      // will land in this pane. Browser-only subtrees use newSurface to
      // create their own surfaces, leaving the split's default terminal unused.
      const rightSession = collectTerminalSurfaces(node.children[1])[0]?.session;
      if (rightSession) {
        const rightCmd = await interactiveSshForSession(coderWs, rightSession);
        await cmux.send(`${rightCmd}\n`, { workspace: wsRef, surface: newSurfRef });
        await cmux.waitForPrompt(wsRef, newSurfRef);
      }
    }

    await walkLayout(node.children[0], wsRef, coderWs, surfRef, sessions, sshCtx);
    await walkLayout(node.children[1], wsRef, coderWs, newSurfRef, sessions, sshCtx);
  }
}

async function configureSurfaces(
  node: PaneNode,
  wsRef: string,
  surfRef: string,
  sessions: Array<{ name: string; command?: string }>,
  sshCtx: SshContext,
  coderWs: string,
): Promise<void> {
  const surfaces = node.pane.surfaces;

  // newSurface (without --pane) targets the focused pane, so anchor focus here
  // before iterating.
  await cmux.focusSurface(wsRef, surfRef);

  for (let i = 0; i < surfaces.length; i++) {
    const surface = surfaces[i]!;

    if (surface.type === "browser") {
      await cmux.newSurface({
        workspace: wsRef,
        type: "browser",
        url: surface.url,
      });
    } else {
      const cmd = normalizeCommand(surface.command, surface.cwd);

      // Index 0 uses the surface from the split (or SSH workspace default).
      // Additional surfaces in the same pane need newSurface.
      let targetSurf: string = surfRef;
      if (i > 0) {
        targetSurf = await cmux.newSurface({
          workspace: wsRef,
          type: "terminal",
        });
        if (!sshCtx.useCmuxSsh) {
          const sshCmd = await interactiveSshForSession(coderWs, surface.session!);
          await cmux.send(`${sshCmd}\n`, { workspace: wsRef, surface: targetSurf });
          await cmux.waitForPrompt(wsRef, targetSurf);
        }
      }

      const sendOpts = { workspace: wsRef, surface: targetSurf };

      // With cmuxSsh: false, SSH already targets the session-suffixed host so
      // RemoteCommand attaches zmx on every (re)connect. For the managed
      // cmux ssh path, attach explicitly since the host is session-less.
      if (sshCtx.useCmuxSsh && surface.session) {
        await cmux.send(`zmx attach ${surface.session}\n`, sendOpts);
        if (cmd) {
          await cmux.waitForPrompt(wsRef, targetSurf);
        }
      }

      if (cmd) {
        await cmux.send(`${cmd}\n`, sendOpts);
      }

      sessions.push({ name: surface.session!, command: cmd });
    }
  }
}
