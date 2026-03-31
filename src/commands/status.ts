import { defineCommand } from "citty";
import { consola } from "consola";
import pc from "picocolors";

export const statusCommand = defineCommand({
  meta: {
    name: "status",
    description: "Show status of Coder workspaces and Cmux sessions",
  },
  async run() {
    consola.info("Checking workspace status...");
    // TODO: query Coder API for workspace status
    // TODO: query Cmux for active sessions
    consola.log(pc.dim("(not yet implemented)"));
  },
});
