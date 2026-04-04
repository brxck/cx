import { defineCommand } from "citty";
import { listCommand } from "./list.ts";
import { sshCommand } from "./ssh.ts";
import { portForwardCommand } from "./port-forward.ts";
import { execCommand } from "./exec.ts";
import { openCommand } from "./open.ts";
import { logsCommand } from "./logs.ts";

export const coderCommand = defineCommand({
  meta: {
    name: "coder",
    description: "Coder workspace utilities",
  },
  subCommands: {
    list: listCommand,
    ssh: sshCommand,
    ports: portForwardCommand,
    exec: execCommand,
    open: openCommand,
    logs: logsCommand,
  },
});
