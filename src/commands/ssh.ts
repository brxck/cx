import { defineCommand } from "citty";
import { consola } from "consola";
import * as p from "@clack/prompts";
import pc from "picocolors";
import { sshIntoWorkspace, requireCoderLogin } from "../lib/coder.ts";
import { pickWorkspace } from "../lib/workspace-picker.ts";
import { getSessions, recordSession } from "../lib/store.ts";
import { generateSessionName } from "../lib/session-names.ts";

export const sshCommand = defineCommand({
  meta: {
    name: "ssh",
    description: "SSH into a Coder workspace",
  },
  args: {
    workspace: {
      type: "positional",
      description: "Workspace name (fuzzy matched, or pick interactively)",
      required: false,
    },
    session: {
      type: "string",
      alias: "s",
      description: "ZMX session name (appended as .<session> to the host)",
      required: false,
    },
    "no-session": {
      type: "boolean",
      alias: "S",
      description: "Connect without a ZMX session",
      default: false,
    },
  },
  async run({ args }) {
    await requireCoderLogin();

    const ws = await pickWorkspace({
      filter: args.workspace as string | undefined,
      message: "Select a workspace to SSH into",
    });

    if (!ws) {
      consola.warn(
        args.workspace
          ? `No workspaces matching "${args.workspace}"`
          : "No workspaces found."
      );
      process.exit(1);
    }

    let session = args.session as string | undefined;
    const noSession = args["no-session"] as boolean;

    // Interactive session selection when no flags provided
    if (!session && !noSession) {
      const previous = await getSessions(ws.name);
      const suggested = generateSessionName(previous);
      const CUSTOM = "__custom__";
      const NONE = "__none__";

      const choice = await p.autocomplete({
        message: "Session",
        options: [
          { value: suggested, label: suggested, hint: "new session" },
          { value: CUSTOM, label: "Custom name...", hint: "enter a name" },
          ...previous.map((s) => ({ value: s, label: s })),
          { value: NONE, label: pc.dim("No session"), hint: "plain SSH" },
        ],
        placeholder: "Type to filter",
      });

      if (p.isCancel(choice)) {
        process.exit(0);
      }

      if (choice === CUSTOM) {
        const name = await p.text({
          message: "Session name",
        });
        if (p.isCancel(name) || !name) {
          process.exit(0);
        }
        session = name;
      } else if (choice !== NONE && choice) {
        session = choice as string;
      }
    }

    if (session) {
      await recordSession(ws.name, session);
      consola.info(`Connecting to ${pc.bold(ws.name)} session ${pc.cyan(session)} via SSH...`);
    } else {
      consola.info(`Connecting to ${pc.bold(ws.name)} via SSH...`);
    }

    await sshIntoWorkspace(ws.name, session);
  },
});
