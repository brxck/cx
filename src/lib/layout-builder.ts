import * as p from "@clack/prompts";
import pc from "picocolors";
import * as cmux from "./cmux.ts";
import {
  isSplitNode,
  isPaneNode,
  type TemplateConfig,
  type LayoutNode,
  type PaneNode,
  type SurfaceConfig,
} from "./templates.ts";
import { consola } from "consola";
import { generateSessionName } from "./session-names.ts";
import { getSessions } from "./store.ts";
import { sshHost, sshHostWithSession } from "./ssh.ts";

export interface BuiltLayout {
  cmuxRef: string;
  sessions: Array<{ name: string; command?: string }>;
  sshMode: boolean;
}

/**
 * Create a Cmux workspace and populate it by walking the template's layout tree.
 * Dispatches to SSH or legacy path based on template config.
 */
export async function buildCmuxLayout(
  layoutName: string,
  template: TemplateConfig,
  coderWsName: string,
): Promise<BuiltLayout> {
  if (template.ssh !== false) {
    return buildSshLayout(layoutName, template, coderWsName);
  }
  return buildLegacyLayout(layoutName, template, coderWsName);
}

/**
 * Create a Cmux SSH workspace. The SSH surface is the first terminal pane.
 * Browser panes auto-proxy through the relay daemon's SOCKS5 proxy.
 * Secondary terminals are local panes with SSH commands.
 */
async function buildSshLayout(
  layoutName: string,
  template: TemplateConfig,
  coderWsName: string,
): Promise<BuiltLayout> {
  const spinner = p.spinner();
  spinner.start("Building SSH layout");

  const existingSessions = getSessions(coderWsName);
  assignSessionNames(template.layout, existingSessions);

  const host = await sshHost(coderWsName);
  const { workspace: wsRef } = await cmux.ssh(host, { name: layoutName });

  if (template.color) {
    await cmux.setWorkspaceColor(wsRef, template.color);
  }

  const sessions: Array<{ name: string; command?: string }> = [];
  await walkSshLayout(template.layout, wsRef, coderWsName, true, sessions);

  spinner.stop(`SSH layout built — ${pc.cyan(wsRef)}`);
  return { cmuxRef: wsRef, sessions, sshMode: true };
}

/** Legacy: create workspace with cmux new-workspace and send SSH commands. */
async function buildLegacyLayout(
  layoutName: string,
  template: TemplateConfig,
  coderWsName: string,
): Promise<BuiltLayout> {
  const spinner = p.spinner();
  spinner.start("Building Cmux layout");

  const existingSessions = getSessions(coderWsName);
  assignSessionNames(template.layout, existingSessions);

  const wsRef = await cmux.newWorkspace({ name: layoutName });

  if (template.color) {
    await cmux.setWorkspaceColor(wsRef, template.color);
  }

  const sessions: Array<{ name: string; command?: string }> = [];
  await walkLegacyLayout(template.layout, wsRef, coderWsName, true, sessions);

  spinner.stop(`Cmux layout built — ${pc.cyan(wsRef)}`);
  return { cmuxRef: wsRef, sessions, sshMode: false };
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

  const existingSessions = getSessions(coderWsName);
  assignSessionNames(template.layout, existingSessions);

  const surfaces = collectTerminalSurfaces(template.layout);
  const sessions: Array<{ name: string; command?: string }> = [];

  for (const surface of surfaces) {
    const sessionName = surface.session!;
    const command = surface.command ?? "";
    const host = await sshHost(coderWsName);
    await Bun.$`ssh ${host} -- zmx run ${sessionName} ${command}`.quiet();
    sessions.push({ name: sessionName, command: surface.command });
  }

  spinner.stop(`${sessions.length} ZMX sessions started`);
  return sessions;
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
 * Walk a layout tree and assign session names to terminal surfaces that lack one.
 * Mutates the tree in place.
 */
export function assignSessionNames(node: LayoutNode, existingSessions: string[]): void {
  const assigned = [...existingSessions];
  const terminals = collectTerminalSurfaces(node);
  for (const surface of terminals) {
    if (!surface.session) {
      surface.session = generateSessionName(assigned);
      assigned.push(surface.session);
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

// ── SSH layout helpers ──

async function walkSshLayout(
  node: LayoutNode,
  wsRef: string,
  coderWs: string,
  isFirst: boolean,
  sessions: Array<{ name: string; command?: string }>,
): Promise<void> {
  if (isPaneNode(node)) {
    await configureSshSurfaces(node, wsRef, coderWs, isFirst, sessions);
    return;
  }

  if (isSplitNode(node)) {
    await walkSshLayout(node.children[0], wsRef, coderWs, isFirst, sessions);

    const direction = node.direction === "horizontal" ? "right" : "down";
    await cmux.newPane({ workspace: wsRef, direction });

    await walkSshLayout(node.children[1], wsRef, coderWs, true, sessions);
  }
}

async function configureSshSurfaces(
  node: PaneNode,
  wsRef: string,
  coderWs: string,
  isFirst: boolean,
  sessions: Array<{ name: string; command?: string }>,
): Promise<void> {
  const surfaces = node.pane.surfaces;

  for (let i = 0; i < surfaces.length; i++) {
    const surface = surfaces[i]!;
    const isFirstSurface = i === 0 && isFirst;

    if (surface.type === "browser") {
      await cmux.newSurface({
        workspace: wsRef,
        type: "browser",
        url: surface.url,
      });
    } else if (isFirstSurface) {
      // The SSH workspace surface is already connected to the remote.
      // Send zmx attach to start the session on it.
      if (surface.session) {
        const zmxCmd = surface.command
          ? `zmx attach ${surface.session} -- ${surface.command}`
          : `zmx attach ${surface.session}`;
        await cmux.send(`${zmxCmd}\n`, { workspace: wsRef });
      }
      sessions.push({ name: surface.session!, command: surface.command });
    } else {
      // Secondary terminals: local panes with SSH commands.
      // No -R socket forwarding needed — the relay daemon handles it.
      const sshCmd = await buildSshCommand(coderWs, { session: surface.session, command: surface.command });
      const surfRef = await cmux.newSurface({
        workspace: wsRef,
        type: "terminal",
      });
      await cmux.send(`${sshCmd}\n`, {
        workspace: wsRef,
        surface: surfRef,
      });
      sessions.push({ name: surface.session!, command: surface.command });
    }
  }
}

/** Build SSH command for secondary panes (no socket forwarding — relay daemon handles it). */
async function buildSshCommand(coderWs: string, opts?: { session?: string; command?: string }): Promise<string> {
  const host = opts?.session
    ? await sshHostWithSession(coderWs, opts.session)
    : await sshHost(coderWs);
  const remoteCmd = opts?.command ? ` -t '${opts.command}'` : "";
  return `ssh ${host}${remoteCmd}`;
}

// ── Legacy layout helpers ──

async function walkLegacyLayout(
  node: LayoutNode,
  wsRef: string,
  coderWs: string,
  isFirst: boolean,
  sessions: Array<{ name: string; command?: string }>,
): Promise<void> {
  if (isPaneNode(node)) {
    await configureLegacySurfaces(node, wsRef, coderWs, isFirst, sessions);
    return;
  }

  if (isSplitNode(node)) {
    await walkLegacyLayout(node.children[0], wsRef, coderWs, isFirst, sessions);

    const direction = node.direction === "horizontal" ? "right" : "down";
    await cmux.newPane({ workspace: wsRef, direction });

    await walkLegacyLayout(node.children[1], wsRef, coderWs, true, sessions);
  }
}

async function configureLegacySurfaces(
  node: PaneNode,
  wsRef: string,
  coderWs: string,
  isFirst: boolean,
  sessions: Array<{ name: string; command?: string }>,
): Promise<void> {
  const surfaces = node.pane.surfaces;

  for (let i = 0; i < surfaces.length; i++) {
    const surface = surfaces[i]!;
    const isFirstSurface = i === 0 && isFirst;

    if (surface.type === "browser") {
      await cmux.newSurface({
        workspace: wsRef,
        type: "browser",
        url: surface.url,
      });
    } else {
      const sshCmd = await buildLegacySshCommand(coderWs, { session: surface.session, command: surface.command });
      if (isFirstSurface) {
        await cmux.send(`${sshCmd}\n`, { workspace: wsRef });
      } else {
        const surfRef = await cmux.newSurface({
          workspace: wsRef,
          type: "terminal",
        });
        await cmux.send(`${sshCmd}\n`, {
          workspace: wsRef,
          surface: surfRef,
        });
      }
      sessions.push({ name: surface.session!, command: surface.command });
    }
  }
}

/** Legacy SSH command with socket forwarding. */
async function buildLegacySshCommand(coderWs: string, opts?: { session?: string; command?: string }): Promise<string> {
  const host = opts?.session
    ? await sshHostWithSession(coderWs, opts.session)
    : await sshHost(coderWs);
  const remoteCmd = opts?.command ? ` -t '${opts.command}'` : "";
  return `ssh -R /tmp/cmux.sock:$CMUX_SOCKET_PATH ${host}${remoteCmd}`;
}
