import { defineCommand } from "citty";
import { consola } from "consola";
import * as p from "@clack/prompts";
import pc from "picocolors";
import { requireCoderLogin } from "../lib/coder.ts";
import { pickWorkspace } from "../lib/workspace-picker.ts";
import { getLayoutsByCoderWorkspace } from "../lib/store.ts";
import { getTemplate } from "../lib/templates.ts";
import { detectPortForwards, stopPortForwards } from "../lib/ports.ts";
import { startPortForwarding } from "../lib/layout-builder.ts";

/** Check if a local TCP port is already in use. */
async function isPortInUse(port: number): Promise<boolean> {
  try {
    const server = Bun.listen({
      hostname: "127.0.0.1",
      port,
      socket: {
        data() {},
      },
    });
    server.stop();
    return false;
  } catch {
    return true;
  }
}

/** Pre-configured port mappings that can be selected from a list. */
const PORT_PRESETS: Array<{ name: string; local: number; remote: number; tcp: string }> = [
  { name: "HTTP",       local: 8081, remote: 8080, tcp: "8081:8080" },
  { name: "HTTPS",      local: 8444, remote: 8443, tcp: "8444:8443" },
  { name: "Node",       local: 3001, remote: 3000, tcp: "3001:3000" },
  { name: "Vite",       local: 5174, remote: 5173, tcp: "5174:5173" },
  { name: "PostgreSQL", local: 5433, remote: 5432, tcp: "5433:5432" },
  { name: "Redis",      local: 6380, remote: 6379, tcp: "6380:6379" },
  { name: "MySQL",      local: 3307, remote: 3306, tcp: "3307:3306" },
];

function formatPresetLabel(
  preset: typeof PORT_PRESETS[number],
  inUseLocally: boolean,
  forwarded: boolean,
): string {
  const name = preset.name.padEnd(10);
  const ports = `${pc.dim(":")}${pc.bold(String(preset.local))} ${pc.dim("←")} ${pc.dim(String(preset.remote))}`;
  const status = forwarded
    ? `  ${pc.green("⇄ forwarded")}`
    : inUseLocally
      ? `  ${pc.yellow("⇄ in use")}`
      : "";
  return `${name} ${ports}${status}`;
}

/** Parse a comma-separated flag value into trimmed mappings. */
function parseMappings(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

/** Find template ports for a workspace via its layout(s), if any. */
async function getTemplatePortsForWorkspace(coderWs: string): Promise<string[] | null> {
  const layouts = getLayoutsByCoderWorkspace(coderWs);
  for (const layout of layouts) {
    if (!layout.template) continue;
    const template = await getTemplate(layout.template);
    if (template?.ports?.length) return template.ports;
  }
  return null;
}

/** Spawn a detached `coder port-forward` process (UDP variant of startPortForwarding). */
function startUdpForwarding(coderWsName: string, mappings: string[]): void {
  const args: string[] = [];
  for (const m of mappings) args.push("--udp", m);
  const proc = Bun.spawn(["coder", "port-forward", coderWsName, ...args], {
    stdout: "ignore",
    stderr: "ignore",
    stdin: "ignore",
  });
  proc.unref();
  consola.info(`UDP port forwarding started: ${pc.dim(mappings.join(", "))} (pid ${proc.pid})`);
}

export const portForwardCommand = defineCommand({
  meta: {
    name: "ports",
    description: "Manage port forwarding for a Coder workspace",
  },
  args: {
    workspace: {
      type: "positional",
      description: "Workspace name (fuzzy matched, or pick interactively)",
      required: false,
    },
    tcp: {
      type: "string",
      description: "TCP port mapping(s), comma-separated (e.g. 8080:8080,3000:3000)",
    },
    udp: {
      type: "string",
      description: "UDP port mapping(s), comma-separated (e.g. 9000:9000)",
    },
    stop: {
      type: "boolean",
      description: "Stop all active port forwards for the workspace",
    },
    template: {
      type: "boolean",
      description: "Start port forwards defined in the workspace's layout template",
    },
  },
  async run({ args }) {
    await requireCoderLogin();

    const ws = await pickWorkspace({
      filter: args.workspace as string | undefined,
      message: "Select a workspace for port forwarding",
    });

    if (!ws) {
      consola.warn(
        args.workspace
          ? `No workspaces matching "${args.workspace}"`
          : "No workspaces found.",
      );
      process.exit(1);
    }

    const tcpFlag = parseMappings(args.tcp as string | undefined);
    const udpFlag = parseMappings(args.udp as string | undefined);
    const wantStop = Boolean(args.stop);
    const wantTemplate = Boolean(args.template);
    const nonInteractive = tcpFlag.length > 0 || udpFlag.length > 0 || wantStop || wantTemplate;

    if (nonInteractive) {
      if (wantStop) {
        const killed = await stopPortForwards(ws.name);
        if (killed > 0) {
          consola.success(`Stopped port forwarding for ${pc.bold(ws.name)}`);
        } else {
          consola.warn(`No port forwards found for ${ws.name}`);
        }
      }
      if (wantTemplate) {
        const ports = await getTemplatePortsForWorkspace(ws.name);
        if (!ports) {
          consola.warn(`No template ports configured for ${pc.bold(ws.name)}`);
        } else {
          startPortForwarding(ws.name, ports);
        }
      }
      if (tcpFlag.length > 0) startPortForwarding(ws.name, tcpFlag);
      if (udpFlag.length > 0) startUdpForwarding(ws.name, udpFlag);
      return;
    }

    // Interactive mode
    const running = await detectPortForwards();
    const active = running.filter((r) => r.workspace === ws.name);
    const activePorts = new Set(active.flatMap((r) => r.ports));

    if (activePorts.size > 0) {
      consola.info(
        `Active forwards on ${pc.bold(ws.name)}: ${pc.dim([...activePorts].join(", "))}`,
      );
    }

    const templatePorts = await getTemplatePortsForWorkspace(ws.name);
    const pendingTemplate = templatePorts?.filter((p) => !activePorts.has(p)) ?? [];

    const CUSTOM_VALUE = "__custom__";
    const STOP_VALUE = "__stop__";
    const TEMPLATE_VALUE = "__template__";

    const portStatus = await Promise.all(
      PORT_PRESETS.map(async (preset) => ({
        ...preset,
        inUseLocally: await isPortInUse(preset.local),
        forwarded: activePorts.has(preset.tcp),
      })),
    );

    const options: Array<{ value: string; label: string }> = [];
    if (activePorts.size > 0) {
      options.push({
        value: STOP_VALUE,
        label: pc.red(`Stop all active forwards (${[...activePorts].join(", ")})`),
      });
    }
    if (pendingTemplate.length > 0) {
      options.push({
        value: TEMPLATE_VALUE,
        label: `${pc.cyan("Start template ports")} ${pc.dim(pendingTemplate.join(", "))}`,
      });
    }
    options.push({
      value: CUSTOM_VALUE,
      label: pc.italic("Custom port mapping(s)"),
    });
    for (const preset of portStatus) {
      options.push({
        value: preset.tcp,
        label: formatPresetLabel(preset, preset.inUseLocally, preset.forwarded),
      });
    }

    const selected = await p.multiselect({
      message: `Select port(s) to forward ${pc.dim("(local ← remote)")}`,
      options,
      required: true,
    });

    if (p.isCancel(selected)) {
      p.cancel("Cancelled.");
      process.exit(0);
    }

    const tcpMappings: string[] = [];

    if (selected.includes(STOP_VALUE)) {
      const killed = await stopPortForwards(ws.name);
      if (killed > 0) {
        consola.success(`Stopped port forwarding for ${pc.bold(ws.name)}`);
      }
    }

    if (selected.includes(TEMPLATE_VALUE) && pendingTemplate.length > 0) {
      tcpMappings.push(...pendingTemplate);
    }

    for (const value of selected) {
      if (value === STOP_VALUE || value === TEMPLATE_VALUE || value === CUSTOM_VALUE) continue;
      if (activePorts.has(value)) continue; // already forwarded; skip duplicate
      tcpMappings.push(value);
    }

    if (selected.includes(CUSTOM_VALUE)) {
      const input = await p.text({
        message: "Enter TCP port mapping(s)",
        placeholder: "8080:8080, 3000:3000",
        validate: (value = "") => {
          if (!value.trim()) return "At least one port mapping is required";
          const parts = value.split(",").map((s) => s.trim());
          for (const part of parts) {
            if (!/^\d+([:\-]\d+)*$/.test(part)) {
              return `Invalid mapping: ${part}`;
            }
          }
        },
      });

      if (p.isCancel(input)) {
        p.cancel("Cancelled.");
        process.exit(0);
      }

      tcpMappings.push(...parseMappings(input));
    }

    if (tcpMappings.length > 0) {
      startPortForwarding(ws.name, tcpMappings);
    }
  },
});
