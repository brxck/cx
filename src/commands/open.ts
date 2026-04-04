import { defineCommand } from "citty";
import { consola } from "consola";
import * as p from "@clack/prompts";
import pc from "picocolors";
import {
  getCoderUrl,
  dashboardUrl,
  openInBrowser,
  openInVSCode,
} from "../lib/coder.ts";
import { pickWorkspace } from "../lib/workspace-picker.ts";

export const openCommand = defineCommand({
  meta: {
    name: "open",
    description: "Open a workspace in the browser or VS Code",
  },
  args: {
    workspace: {
      type: "positional",
      description: "Workspace name (fuzzy matched, or pick interactively)",
      required: false,
    },
    target: {
      type: "string",
      alias: "t",
      description: "Target: dashboard, vscode",
      required: false,
    },
  },
  async run({ args }) {
    const ws = await pickWorkspace({
      filter: args.workspace as string | undefined,
      message: "Select a workspace to open",
    });

    if (!ws) {
      consola.warn(
        args.workspace
          ? `No workspaces matching "${args.workspace}"`
          : "No workspaces found.",
      );
      process.exit(1);
    }

    let target = args.target as string | undefined;

    if (!target) {
      const choice = await p.select({
        message: "Open in",
        options: [
          { value: "dashboard", label: "Dashboard", hint: "browser" },
          { value: "vscode", label: "VS Code", hint: "coder open vscode" },
        ],
      });

      if (p.isCancel(choice)) process.exit(0);
      target = choice as string;
    }

    if (target === "dashboard") {
      const baseUrl = await getCoderUrl();
      const url = dashboardUrl(baseUrl, ws.owner_name, ws.name);
      consola.info(`Opening ${pc.bold(ws.name)} in browser...`);
      await openInBrowser(url);
    } else if (target === "vscode") {
      consola.info(`Opening ${pc.bold(ws.name)} in VS Code...`);
      await openInVSCode(ws.name);
    } else {
      consola.error(`Unknown target: ${target}. Use "dashboard" or "vscode".`);
      process.exit(1);
    }
  },
});
