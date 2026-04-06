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
import { generateSessionName } from "./session-names.ts";
import { getSessions } from "./store.ts";
import { sshHost } from "./ssh.ts";

export interface BuiltLayout {
  cmuxRef: string;
  sessions: Array<{ name: string; command?: string }>;
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

  const existingSessions = getSessions(coderWsName);
  assignSessionNames(template.layout, existingSessions);

  const host = await sshHost(coderWsName);
  const { workspace: wsRef } = await cmux.ssh(host, { name: layoutName });

  if (template.color) {
    await cmux.setWorkspaceColor(wsRef, template.color);
  }

  const sessions: Array<{ name: string; command?: string }> = [];
  await walkLayout(template.layout, wsRef, coderWsName, undefined, sessions);

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

  const existingSessions = getSessions(coderWsName);
  assignSessionNames(template.layout, existingSessions);

  const surfaces = collectTerminalSurfaces(template.layout);
  const sessions: Array<{ name: string; command?: string }> = [];

  for (const surface of surfaces) {
    const sessionName = surface.session!;
    const command = normalizeCommand(surface.command, surface.cwd) ?? "";
    const host = await sshHost(coderWsName);
    await Bun.$`ssh ${host} -- zmx run ${sessionName} ${command}`.quiet();
    sessions.push({ name: sessionName, command });
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
  surfRef: string | undefined,
  sessions: Array<{ name: string; command?: string }>,
): Promise<void> {
  if (isPaneNode(node)) {
    await configureSurfaces(node, wsRef, surfRef, sessions);
    return;
  }

  if (isSplitNode(node)) {
    await walkLayout(node.children[0], wsRef, coderWs, surfRef, sessions);

    const direction = node.direction === "horizontal" ? "right" : "down";
    const newSurfRef = await cmux.newSplit({ workspace: wsRef, direction });

    await walkLayout(node.children[1], wsRef, coderWs, newSurfRef, sessions);
  }
}

async function configureSurfaces(
  node: PaneNode,
  wsRef: string,
  surfRef: string | undefined,
  sessions: Array<{ name: string; command?: string }>,
): Promise<void> {
  const surfaces = node.pane.surfaces;

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
      const zmxCmd = surface.session
        ? cmd
          ? `zmx attach ${surface.session} -- ${cmd}`
          : `zmx attach ${surface.session}`
        : cmd;

      // Index 0 uses the surface from the split (or SSH workspace default).
      // Additional surfaces in the same pane need newSurface.
      let targetSurf = surfRef;
      if (i > 0) {
        targetSurf = await cmux.newSurface({
          workspace: wsRef,
          type: "terminal",
        });
      }

      if (zmxCmd) {
        consola.debug(`send to surface=${targetSurf ?? "default"}: ${zmxCmd}`);
        await cmux.send(`${zmxCmd}\n`, {
          workspace: wsRef,
          surface: targetSurf,
        });
      }

      sessions.push({ name: surface.session!, command: cmd });
    }
  }
}
