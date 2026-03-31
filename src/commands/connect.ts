import { defineCommand } from "citty";
import { consola } from "consola";
import * as p from "@clack/prompts";
import pc from "picocolors";

export const connectCommand = defineCommand({
  meta: {
    name: "connect",
    description: "Connect to a Coder workspace via Cmux",
  },
  args: {
    workspace: {
      type: "positional",
      description: "Workspace name to connect to",
      required: false,
    },
  },
  async run({ args }) {
    if (args.workspace) {
      consola.info(`Connecting to workspace ${pc.bold(args.workspace)}...`);
      // TODO: establish connection
      consola.log(pc.dim("(not yet implemented)"));
      return;
    }

    // Interactive workspace selection
    p.intro(pc.bgCyan(pc.black(" cmux-coder connect ")));

    const result = await p.group({
      workspace: () =>
        p.text({
          message: "Which workspace do you want to connect to?",
          placeholder: "my-workspace",
          validate: (value = "") => {
            if (!value.trim()) return "Workspace name is required";
          },
        }),
      confirm: ({ results }) =>
        p.confirm({
          message: `Connect to ${pc.bold(results.workspace)}?`,
        }),
    });

    if (p.isCancel(result) || !result.confirm) {
      p.cancel("Connection cancelled.");
      process.exit(0);
    }

    consola.info(`Connecting to workspace ${pc.bold(result.workspace)}...`);
    // TODO: establish connection
    consola.log(pc.dim("(not yet implemented)"));

    p.outro(pc.green("Done"));
  },
});
