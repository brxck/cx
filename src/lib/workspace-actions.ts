import * as p from "@clack/prompts";
import pc from "picocolors";
import { consola } from "consola";
import {
  dashboardUrl,
  openInBrowser,
  startWorkspace,
  stopWorkspace,
  updateWorkspace,
  waitForWorkspace,
  workspaceStatus,
  type CoderWorkspace,
} from "./coder.ts";
import { formatLogForSpinner, printCoderFailure } from "./coder-ui.ts";
import { type LayoutEntry } from "./store.ts";
import { pickLayout } from "./workspace-picker.ts";
import { runSsh } from "../commands/ssh.ts";
import { runExec } from "../commands/exec.ts";
import { runOpen } from "../commands/open.ts";
import { runLogs } from "../commands/logs.ts";
import { runPorts } from "../commands/port-forward.ts";
import { runRestart } from "../commands/restart.ts";
import { runAttach } from "../commands/attach.ts";
import { runActivate } from "../commands/activate.ts";
import { runDetach } from "../commands/detach.ts";
import { runDown } from "../commands/down.ts";
import { runDelete } from "../commands/delete.ts";

export type ActionGroup = "navigation" | "interact" | "lifecycle" | "layout";

export interface ActionContext {
  ws: CoderWorkspace;
  layouts: LayoutEntry[];
  coderBaseUrl: string;
}

export interface WorkspaceAction {
  id: string;
  label: string;
  group: ActionGroup;
  hint?: (ctx: ActionContext) => string | undefined;
  isAvailable(ctx: { ws: CoderWorkspace; layouts: LayoutEntry[] }): boolean;
  run(ctx: ActionContext): Promise<void>;
}

export const GROUP_ORDER: ActionGroup[] = ["navigation", "interact", "lifecycle", "layout"];

/** Pick one of the workspace's layouts, or return the single one if only one exists. */
async function pickWorkspaceLayout(
  layouts: LayoutEntry[],
  message: string,
): Promise<LayoutEntry | null> {
  if (layouts.length === 0) return null;
  if (layouts.length === 1) return layouts[0]!;
  return pickLayout({ layouts, message });
}

function isRunning(ws: CoderWorkspace): boolean {
  return workspaceStatus(ws) === "running";
}

function isStopped(ws: CoderWorkspace): boolean {
  return workspaceStatus(ws) === "stopped";
}

export const WORKSPACE_ACTIONS: WorkspaceAction[] = [
  // ── Navigation ──
  {
    id: "open-app",
    label: "Open app",
    group: "navigation",
    hint: () => "dashboard · VS Code · any tagged app",
    isAvailable: () => true,
    async run({ ws }) {
      await runOpen({ ws });
    },
  },
  {
    id: "dashboard",
    label: "Open dashboard",
    group: "navigation",
    hint: ({ ws, coderBaseUrl }) => dashboardUrl(coderBaseUrl, ws.owner_name, ws.name),
    isAvailable: () => true,
    async run({ ws, coderBaseUrl }) {
      const url = dashboardUrl(coderBaseUrl, ws.owner_name, ws.name);
      consola.info(`Opening ${pc.underline(url)}`);
      await openInBrowser(url);
    },
  },

  // ── Interact ──
  {
    id: "ssh",
    label: "Open SSH",
    group: "interact",
    isAvailable: ({ ws }) => isRunning(ws),
    async run({ ws }) {
      await runSsh({ ws });
    },
  },
  {
    id: "ports",
    label: "Forward ports",
    group: "interact",
    isAvailable: ({ ws }) => isRunning(ws),
    async run({ ws }) {
      await runPorts({ ws });
    },
  },
  {
    id: "exec",
    label: "Run command",
    group: "interact",
    isAvailable: ({ ws }) => isRunning(ws),
    async run({ ws }) {
      const input = await p.text({
        message: "Command to run",
        placeholder: "echo hello",
        validate: (value = "") => {
          if (!value.trim()) return "Command is required";
        },
      });
      if (p.isCancel(input)) {
        p.cancel("Cancelled.");
        process.exit(0);
      }
      const exitCode = await runExec({ ws, command: ["sh", "-c", input] });
      process.exit(exitCode);
    },
  },
  {
    id: "logs",
    label: "Stream logs",
    group: "interact",
    isAvailable: () => true,
    async run({ ws }) {
      const exitCode = await runLogs({ ws, follow: true });
      process.exit(exitCode);
    },
  },

  // ── Lifecycle ──
  {
    id: "start",
    label: "Start workspace",
    group: "lifecycle",
    isAvailable: ({ ws }) => isStopped(ws),
    async run({ ws }) {
      const spinner = p.spinner();
      const startHeading = `Starting ${pc.bold(ws.name)}`;
      spinner.start(startHeading);
      try {
        await startWorkspace(ws.name, {
          onLine: (line) => spinner.message(formatLogForSpinner(startHeading, line)),
        });
        const waitHeading = `Waiting for ${pc.bold(ws.name)}`;
        spinner.message(waitHeading);
        await waitForWorkspace(ws.name, undefined, (line) =>
          spinner.message(formatLogForSpinner(waitHeading, line)),
        );
        spinner.stop(`Workspace ${pc.bold(ws.name)} started and ready`);
      } catch (err) {
        spinner.error(`Failed to start ${pc.bold(ws.name)}`);
        await printCoderFailure(err, { workspace: ws.name });
        throw err;
      }
    },
  },
  {
    id: "stop",
    label: "Stop workspace",
    group: "lifecycle",
    isAvailable: ({ ws }) => isRunning(ws),
    async run({ ws }) {
      const spinner = p.spinner();
      const heading = `Stopping ${pc.cyan(ws.name)}`;
      spinner.start(heading);
      try {
        await stopWorkspace(ws.name, {
          onLine: (line) => spinner.message(formatLogForSpinner(heading, line)),
        });
        spinner.stop(`${pc.cyan(ws.name)} stopped`);
      } catch (err) {
        spinner.error(`Failed to stop ${pc.cyan(ws.name)}`);
        await printCoderFailure(err, { workspace: ws.name });
        throw err;
      }
    },
  },
  {
    id: "restart",
    label: "Restart workspace",
    group: "lifecycle",
    isAvailable: ({ ws }) => isRunning(ws),
    async run({ ws }) {
      await runRestart({ ws });
    },
  },
  {
    id: "update",
    label: "Update workspace",
    group: "lifecycle",
    hint: ({ ws }) => (ws.outdated ? "template is outdated" : undefined),
    isAvailable: ({ ws }) => isStopped(ws) && ws.outdated,
    async run({ ws }) {
      const spinner = p.spinner();
      const heading = `Updating ${pc.cyan(ws.name)} to latest template`;
      spinner.start(heading);
      try {
        await updateWorkspace(ws.name, {
          onLine: (line) => spinner.message(formatLogForSpinner(heading, line)),
        });
        spinner.stop(`${pc.cyan(ws.name)} updated`);
      } catch (err) {
        spinner.error(`Failed to update ${pc.cyan(ws.name)}`);
        await printCoderFailure(err, { workspace: ws.name });
        throw err;
      }
    },
  },
  {
    id: "delete",
    label: "Delete workspace",
    group: "lifecycle",
    hint: () => "permanent — removes all layouts",
    isAvailable: () => true,
    async run({ ws, layouts }) {
      await runDelete({ ws, layouts });
    },
  },

  // ── Layout (Cmux) ──
  {
    id: "attach",
    label: "Attach layout",
    group: "layout",
    isAvailable: ({ ws }) => isRunning(ws),
    async run({ ws }) {
      await runAttach({ ws });
    },
  },
  {
    id: "activate",
    label: "Activate layout",
    group: "layout",
    isAvailable: ({ layouts }) => layouts.length > 0,
    async run({ layouts }) {
      const layout = await pickWorkspaceLayout(layouts, "Select a layout to activate");
      if (!layout) process.exit(0);
      await runActivate({ layout });
    },
  },
  {
    id: "detach",
    label: "Detach layout",
    group: "layout",
    isAvailable: ({ layouts }) => layouts.length > 0,
    async run({ layouts }) {
      const layout = await pickWorkspaceLayout(layouts, "Select a layout to detach");
      if (!layout) process.exit(0);
      await runDetach({ layout });
    },
  },
  {
    id: "down",
    label: "Tear down layout",
    group: "layout",
    isAvailable: ({ layouts }) => layouts.length > 0,
    async run({ layouts }) {
      const layout = await pickWorkspaceLayout(layouts, "Select a layout to tear down");
      if (!layout) process.exit(0);
      await runDown({ layout });
    },
  },
];

interface SelectOption {
  value: string;
  label: string;
  hint?: string;
}

/** Build a flat list of action options, ordered by group but without visual headers. */
export function buildActionOptions(
  actions: WorkspaceAction[],
  ctx: ActionContext,
): SelectOption[] {
  const groupRank = new Map(GROUP_ORDER.map((g, i) => [g, i]));
  const sorted = [...actions].sort(
    (a, b) => (groupRank.get(a.group) ?? 0) - (groupRank.get(b.group) ?? 0),
  );
  return sorted.map((action) => ({
    value: action.id,
    label: action.label,
    hint: action.hint?.(ctx),
  }));
}
