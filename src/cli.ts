import { defineCommand, runMain, renderUsage } from "citty";
import type { CommandDef } from "citty";
import { consola } from "consola";
import pc from "picocolors";
import { version } from "../package.json";
import { statusCommand } from "./commands/status.ts";
import { coderCommand } from "./commands/coder.ts";
import { upCommand } from "./commands/up.ts";
import { downCommand } from "./commands/down.ts";
import { attachCommand } from "./commands/attach.ts";
import { detachCommand } from "./commands/detach.ts";
import { activateCommand } from "./commands/activate.ts";
import { findCommand } from "./commands/find.ts";
import { restoreCommand } from "./commands/restore.ts";
import { initCommand } from "./commands/init.ts";

const main = defineCommand({
  meta: {
    name: "cmux-coder",
    version,
    description: "Integrate Cmux with Coder remote dev environments",
  },
  setup() {
    consola.log(
      pc.dim(`cmux-coder v${version}`)
    );
  },
  subCommands: {
    // Lifecycle
    up: upCommand,
    down: downCommand,
    attach: attachCommand,
    detach: detachCommand,
    // Navigation
    status: statusCommand,
    activate: activateCommand,
    find: findCommand,
    restore: restoreCommand,
    // Configuration
    init: initCommand,
    coder: coderCommand,
  },
});

async function customShowUsage(cmd: CommandDef, parent?: CommandDef) {
  const usage = await renderUsage(cmd, parent);
  // Strip the USAGE line (redundant with COMMANDS section)
  const lines = usage.split("\n");
  const filtered = lines.filter(
    (line) => !line.includes("USAGE") && line.trim() !== ""
  );
  console.log(filtered.join("\n") + "\n");
}

runMain(main, { showUsage: customShowUsage });
