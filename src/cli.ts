import { defineCommand, runMain, renderUsage } from "citty";
import type { CommandDef } from "citty";
import pc from "picocolors";
import { version } from "../package.json";
import { upCommand } from "./commands/up.ts";
import { downCommand } from "./commands/down.ts";
import { attachCommand } from "./commands/attach.ts";
import { detachCommand } from "./commands/detach.ts";
import { statusCommand } from "./commands/status.ts";
import { activateCommand } from "./commands/activate.ts";
import { findCommand } from "./commands/find.ts";
import { restoreCommand } from "./commands/restore.ts";
import { listCommand } from "./commands/list.ts";
import { sshCommand } from "./commands/ssh.ts";
import { portForwardCommand } from "./commands/port-forward.ts";
import { execCommand } from "./commands/exec.ts";
import { openCommand } from "./commands/open.ts";
import { logsCommand } from "./commands/logs.ts";
import { initCommand } from "./commands/init.ts";
import { forwardCommand } from "./commands/forward.ts";
import { unforwardCommand } from "./commands/unforward.ts";
import { updateCommand } from "./commands/update.ts";
import { restartCommand } from "./commands/restart.ts";
import { serveCommand } from "./commands/serve.ts";

const commandGroups = [
  {
    label: "Lifecycle",
    commands: ["up", "down", "attach", "detach"],
  },
  {
    label: "Navigation",
    commands: ["status", "activate", "find", "restore"],
  },
  {
    label: "Workspace",
    commands: ["list", "ssh", "ports", "forward", "unforward", "exec", "open", "logs", "update", "restart"],
  },
  {
    label: "Configuration",
    commands: ["init"],
  },
  {
    label: "Server",
    commands: ["serve"],
  },
];

const main = defineCommand({
  meta: {
    name: "cx",
    version,
    description: "Integrate Cmux with Coder remote dev environments",
  },
  subCommands: {
    up: upCommand,
    down: downCommand,
    attach: attachCommand,
    detach: detachCommand,
    status: statusCommand,
    activate: activateCommand,
    find: findCommand,
    restore: restoreCommand,
    list: listCommand,
    ssh: sshCommand,
    ports: portForwardCommand,
    exec: execCommand,
    open: openCommand,
    logs: logsCommand,
    forward: forwardCommand,
    unforward: unforwardCommand,
    update: updateCommand,
    restart: restartCommand,
    init: initCommand,
    serve: serveCommand,
  },
});

async function customShowUsage(cmd: CommandDef<any>, parent?: CommandDef<any>) {
  const usage = await renderUsage(cmd, parent);
  const lines = usage.split("\n");

  // For subcommand help, just strip USAGE and pass through
  const commandsIdx = lines.findIndex((l) => l.includes("COMMANDS"));
  if (commandsIdx === -1) {
    const filtered = lines.filter(
      (line) => !line.includes("USAGE") && line.trim() !== ""
    );
    console.log(filtered.join("\n") + "\n");
    return;
  }

  // For root help, render grouped commands ourselves
  const descLine = lines[0];
  console.log(descLine);

  // Resolve subcommand descriptions
  const resolved = await cmd.subCommands!;
  const descriptions: Record<string, string> = {};
  for (const [name, sub] of Object.entries(resolved)) {
    const def = await (typeof sub === "function" ? sub() : sub);
    descriptions[name] = def.meta?.description ?? "";
  }

  // Find the longest command name for alignment
  const allNames = commandGroups.flatMap((g) => g.commands);
  const maxLen = Math.max(...allNames.map((n) => n.length));

  console.log(`\n${pc.underline(pc.bold("COMMANDS"))}`);
  for (const group of commandGroups) {
    console.log(`\n  ${pc.dim(group.label)}`);
    for (const name of group.commands) {
      const desc = descriptions[name] ?? "";
      const padded = name.padEnd(maxLen + 2);
      console.log(`    ${pc.cyan(padded)}  ${desc}`);
    }
  }

  console.log(
    `\nUse ${pc.cyan("cx <command> --help")} for more information about a command.\n`
  );
}

runMain(main, { showUsage: customShowUsage });
