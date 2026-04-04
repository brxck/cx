import { defineCommand, runMain } from "citty";
import { consola } from "consola";
import pc from "picocolors";
import { version } from "../package.json";
import { statusCommand } from "./commands/status.ts";
import { coderCommand } from "./commands/coder.ts";
import { upCommand } from "./commands/up.ts";
import { downCommand } from "./commands/down.ts";
import { activateCommand } from "./commands/activate.ts";
import { findCommand } from "./commands/find.ts";

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
    status: statusCommand,
    coder: coderCommand,
    up: upCommand,
    down: downCommand,
    activate: activateCommand,
    find: findCommand,
  },
});

runMain(main);
