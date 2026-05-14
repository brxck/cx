import { defineCommand } from "citty";
import { consola } from "consola";
import * as p from "@clack/prompts";
import pc from "picocolors";
import {
  sshIntoWorkspace,
  requireCoderLogin,
  type CoderWorkspace,
} from "../lib/coder.ts";
import { pickWorkspace } from "../lib/workspace-picker.ts";
import { getSessions, recordSession } from "../lib/store.ts";

export interface RunSshOpts {
  ws: CoderWorkspace;
  session?: string;
  noSession?: boolean;
}

export async function runSsh(opts: RunSshOpts): Promise<void> {
  const { ws } = opts;
  let session = opts.session;
  const noSession = opts.noSession ?? false;

  if (!session && !noSession) {
    const previous = getSessions(ws.name);
    const NEW = "__new__";
    const NONE = "__none__";

    const choice = await p.autocomplete({
      message: "Session",
      options: [
        ...previous.map((s) => ({ value: s, label: s })),
        { value: NEW, label: "New session...", hint: "enter a name" },
        { value: NONE, label: pc.dim("No session"), hint: "plain SSH" },
      ],
      placeholder: "Type to filter",
    });

    if (p.isCancel(choice)) {
      process.exit(0);
    }

    if (choice === NEW) {
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
}

export const sshCommand = defineCommand({
  meta: {
    name: "ssh",
    description: "SSH into a Coder workspace",
  },
  args: {
    workspace: {
      type: "positional",
      description: "Workspace name",
      required: false,
    },
    session: {
      type: "positional",
      description: "ZMX session name",
      required: false,
    },
    "no-session": {
      type: "boolean",
      alias: "S",
      description: "Connect without a ZMX session",
      default: false,
    },
    all: {
      type: "boolean",
      alias: "a",
      description: "Show all workspaces including stopped",
      default: false,
    },
  },
  async run({ args }) {
    const workspace = args.workspace as string | undefined;
    const session = args.session as string | undefined;

    if (workspace && session) {
      await recordSession(workspace, session);
      consola.info(`Connecting to ${pc.bold(workspace)} session ${pc.cyan(session)} via SSH...`);
      await sshIntoWorkspace(workspace, session);
      return;
    }

    await requireCoderLogin();

    const ws = await pickWorkspace({
      filter: workspace,
      message: "Select a workspace to SSH into",
      showStopped: args.all as boolean,
    });

    if (!ws) {
      consola.warn(
        workspace
          ? `No workspaces matching "${workspace}"`
          : "No workspaces found."
      );
      process.exit(1);
    }

    await runSsh({
      ws,
      session,
      noSession: args["no-session"] as boolean,
    });
  },
});
