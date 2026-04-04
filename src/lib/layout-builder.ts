import * as p from "@clack/prompts";
import pc from "picocolors";
import * as cmux from "./cmux.ts";
import {
  isSplitNode,
  isPaneNode,
  type TemplateConfig,
  type LayoutNode,
  type PaneNode,
} from "./templates.ts";
import { consola } from "consola";

/**
 * Create a Cmux workspace and populate it by walking the template's layout tree.
 * Returns the Cmux workspace ref.
 */
export async function buildCmuxLayout(
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
): Promise<void> {
  if (isPaneNode(node)) {
    await configureSurfaces(node, wsRef, coderWs, isFirst);
    return;
  }

  if (isSplitNode(node)) {
    await walkLayout(node.children[0], wsRef, coderWs, isFirst);

    const direction = node.direction === "horizontal" ? "right" : "down";
    await cmux.newPane({ workspace: wsRef, direction });

    await walkLayout(node.children[1], wsRef, coderWs, true);
  }
}

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
      await cmux.newSurface({
        workspace: wsRef,
        type: "browser",
        url: surface.url,
      });
    } else {
      const sshCmd = buildSshCommand(coderWs, { session: surface.session, command: surface.command });
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
    }
  }
}

function buildSshCommand(coderWs: string, opts?: { session?: string; command?: string }): string {
  const host = opts?.session ? `coder.${coderWs}.${opts.session}` : `coder.${coderWs}`;
  const remoteCmd = opts?.command ? ` -t '${opts.command}'` : "";
  return `ssh -R /tmp/cmux.sock:$CMUX_SOCKET_PATH ${host}${remoteCmd}`;
}
