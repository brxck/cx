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
}

/**
 * Create a Cmux workspace and populate it by walking the template's layout tree.
 * Returns the Cmux workspace ref and session info.
 */
export async function buildCmuxLayout(
  layoutName: string,
  template: TemplateConfig,
  coderWsName: string,
): Promise<BuiltLayout> {
  const spinner = p.spinner();
  spinner.start("Building Cmux layout");

  // Assign session names to all terminal surfaces that don't have one
  const existingSessions = getSessions(coderWsName);
  assignSessionNames(template.layout, existingSessions);

  const wsRef = await cmux.newWorkspace({ name: layoutName });

  if (template.color) {
    await cmux.setWorkspaceColor(wsRef, template.color);
  }

  // The workspace starts with one pane — the first leaf in the tree uses it
  const sessions: Array<{ name: string; command?: string }> = [];
  await walkLayout(template.layout, wsRef, coderWsName, true, sessions);

  spinner.stop(`Cmux layout built — ${pc.cyan(wsRef)}`);
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

// ── Internal helpers ──

async function walkLayout(
  node: LayoutNode,
  wsRef: string,
  coderWs: string,
  isFirst: boolean,
  sessions: Array<{ name: string; command?: string }>,
): Promise<void> {
  if (isPaneNode(node)) {
    await configureSurfaces(node, wsRef, coderWs, isFirst, sessions);
    return;
  }

  if (isSplitNode(node)) {
    await walkLayout(node.children[0], wsRef, coderWs, isFirst, sessions);

    const direction = node.direction === "horizontal" ? "right" : "down";
    await cmux.newPane({ workspace: wsRef, direction });

    await walkLayout(node.children[1], wsRef, coderWs, true, sessions);
  }
}

async function configureSurfaces(
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
      const sshCmd = await buildSshCommand(coderWs, { session: surface.session, command: surface.command });
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

async function buildSshCommand(coderWs: string, opts?: { session?: string; command?: string }): Promise<string> {
  const host = opts?.session
    ? await sshHostWithSession(coderWs, opts.session)
    : await sshHost(coderWs);
  const remoteCmd = opts?.command ? ` -t '${opts.command}'` : "";
  return `ssh -R /tmp/cmux.sock:$CMUX_SOCKET_PATH ${host}${remoteCmd}`;
}
