import { defineCommand } from "citty";
import { consola } from "consola";
import * as p from "@clack/prompts";
import pc from "picocolors";
import { pickWorkspace } from "../lib/workspace-picker.ts";

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

/** Parse the local port from a mapping string like "8081:8080" or "8080". */
function parseLocalPort(mapping: string): number {
  const parts = mapping.split(":");
  return parseInt(parts[0]!, 10);
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

function formatPresetLabel(preset: typeof PORT_PRESETS[number], inUse: boolean): string {
  const name = preset.name.padEnd(10);
  const ports = `${pc.dim(":")}${pc.bold(String(preset.local))} ${pc.dim("←")} ${pc.dim(String(preset.remote))}`;
  const status = inUse ? `  ${pc.yellow("⇄ in use")}` : "";
  return `${name} ${ports}${status}`;
}

export const portForwardCommand = defineCommand({
  meta: {
    name: "ports",
    description: "Forward ports from a Coder workspace to your local machine",
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
  },
  async run({ args }) {
    const ws = await pickWorkspace({
      filter: args.workspace as string | undefined,
      message: "Select a workspace for port forwarding",
    });

    if (!ws) {
      consola.warn(
        args.workspace
          ? `No workspaces matching "${args.workspace}"`
          : "No workspaces found."
      );
      process.exit(1);
    }

    let tcpMappings: string[] = [];
    let udpMappings: string[] = [];

    if (args.tcp) {
      tcpMappings = (args.tcp as string).split(",").map((s) => s.trim());
    }
    if (args.udp) {
      udpMappings = (args.udp as string).split(",").map((s) => s.trim());
    }

    // Interactive port selection if no mappings provided
    if (tcpMappings.length === 0 && udpMappings.length === 0) {
      const CUSTOM_VALUE = "__custom__";

      const portStatus = await Promise.all(
        PORT_PRESETS.map(async (preset) => ({
          ...preset,
          inUse: await isPortInUse(preset.local),
        }))
      );

      const selected = await p.multiselect({
        message: `Select port(s) to forward ${pc.dim("(local ← remote)")}`,
        options: [
          {
            value: CUSTOM_VALUE,
            label: pc.italic("Custom port mapping(s)"),
          },
          ...portStatus.map((preset) => ({
            value: preset.tcp,
            label: formatPresetLabel(preset, preset.inUse),
          })),
        ],
        required: true,
      });

      if (p.isCancel(selected)) {
        p.cancel("Cancelled.");
        process.exit(0);
      }

      const presetSelections = selected.filter((v) => v !== CUSTOM_VALUE);
      tcpMappings.push(...presetSelections);

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

        tcpMappings.push(...input.split(",").map((s) => s.trim()));
      }
    }

    // Build coder port-forward args
    const cliArgs = ["coder", "port-forward", ws.name];
    for (const mapping of tcpMappings) {
      cliArgs.push("--tcp", mapping);
    }
    for (const mapping of udpMappings) {
      cliArgs.push("--udp", mapping);
    }

    const summary = [
      ...tcpMappings.map((m) => `TCP ${m}`),
      ...udpMappings.map((m) => `UDP ${m}`),
    ].join(", ");

    consola.info(
      `Forwarding ${pc.bold(summary)} on ${pc.bold(ws.name)}`
    );

    const proc = Bun.spawn(cliArgs, {
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });
    const code = await proc.exited;
    process.exit(code);
  },
});
