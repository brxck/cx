import { defineCommand, runMain } from "citty";
import { consola } from "consola";
import pc from "picocolors";
import { version } from "../package.json";
import { statusCommand } from "./commands/status.ts";
import { listCommand } from "./commands/list.ts";
import { sshCommand } from "./commands/ssh.ts";
import { portForwardCommand } from "./commands/port-forward.ts";

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
list: listCommand,
    ssh: sshCommand,
    ports: portForwardCommand,
  },
});

runMain(main);
