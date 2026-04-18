import { defineCommand } from "citty";
import * as p from "@clack/prompts";
import pc from "picocolors";
import {
  ensureSshConfig,
  workspaceStatus,
  requireCoderLogin,
  startWorkspace,
  waitForWorkspace,
  type CoderWorkspace,
} from "../lib/coder.ts";
import {
  resolveTemplate,
  type TemplateConfig,
  listTemplatesAsync,
  getProjectTemplates,
} from "../lib/templates.ts";
import { parseVarsArg, resolveVariables } from "../lib/variables.ts";
import { saveLayout, getLayout, getSessionsForLayout, recordSession } from "../lib/store.ts";
import { buildCmuxLayout, startPortForwarding, collectTerminalSurfaces } from "../lib/layout-builder.ts";
import { isSplitNode, isPaneNode, type LayoutNode } from "../lib/templates.ts";
import { pickWorkspace } from "../lib/workspace-picker.ts";

export interface RunAttachOpts {
  ws: CoderWorkspace;
  template?: string;
  vars?: string;
  noPorts?: boolean;
  runCommands?: boolean;
}

export async function runAttach(opts: RunAttachOpts): Promise<void> {
  const workspace = opts.ws;

  const status = workspaceStatus(workspace);
  if (status !== "running") {
    if (status === "stopped") {
      const shouldStart = await p.confirm({
        message: `Workspace ${pc.bold(workspace.name)} is stopped. Start it?`,
        initialValue: true,
      });
      if (p.isCancel(shouldStart) || !shouldStart) {
        p.cancel("Cancelled.");
        process.exit(0);
      }
      const spinner = p.spinner();
      spinner.start(`Starting workspace ${pc.bold(workspace.name)}`);
      await startWorkspace(workspace.name);
      await waitForWorkspace(workspace.name);
      spinner.stop(`Workspace ${pc.bold(workspace.name)} started and ready`);
    } else {
      p.log.error(
        `Workspace ${pc.bold(workspace.name)} is ${status} — it must be running to attach`,
      );
      process.exit(1);
    }
  }

  const layoutName = workspace.name;

  p.intro(pc.bold(`cx attach ${pc.cyan(layoutName)}`));

  // Check for existing headless layout
  const existingLayout = getLayout(layoutName);
  const isHeadlessReattach = existingLayout?.cmux_id === "headless";

  // Resolve template
  let template: TemplateConfig;
  let projectPath: string | null = null;

  if (opts.template) {
    const resolved = await resolveTemplate({ name: opts.template });
    if (resolved) {
      template = resolved.template;
      projectPath = resolved.projectPath;
    } else {
      p.log.error(`Template ${pc.bold(opts.template)} not found`);
      process.exit(1);
    }
  } else {
    const defaultTemplate: TemplateConfig = {
      name: "default",
      coder: { template: workspace.template_name },
      type: "persistent",
      layout: {
        pane: {
          surfaces: [{ type: "terminal" }],
        },
      },
    };

    const project = await getProjectTemplates();
    const projectTemplates = project?.templates ?? [];
    const globalTemplates = await listTemplatesAsync();

    type PickerEntry = { template: TemplateConfig; source: "project" | "global" | "default" };
    const entries: PickerEntry[] = [
      ...projectTemplates.map((t) => ({ template: t, source: "project" as const })),
      ...globalTemplates.map((t) => ({ template: t, source: "global" as const })),
      { template: defaultTemplate, source: "default" as const },
    ];

    entries.sort((a, b) => {
      if (a.source === "default") return 1;
      if (b.source === "default") return -1;
      return a.template.name.localeCompare(b.template.name);
    });

    if (entries.length === 1) {
      template = defaultTemplate;
    } else {
      const choice = await p.autocomplete({
        message: "Select a template",
        options: entries.map((e) => ({
          value: e,
          label:
            e.source === "default"
              ? `${pc.bold("default")}  ${pc.dim("single pane")}`
              : `${pc.bold(e.template.name)}  ${pc.dim(e.template.coder.template)}  ${pc.dim(e.template.type)}${e.source === "project" ? `  ${pc.dim("(project)")}` : ""}`,
        })),
        placeholder: "Type to filter",
      });

      if (p.isCancel(choice)) {
        p.cancel("Cancelled.");
        process.exit(0);
      }

      const picked = choice as PickerEntry;
      template = picked.template;
      projectPath = picked.source === "project" ? (project?.projectPath ?? null) : null;
    }
  }

  const runCommands = opts.runCommands ?? false;

  if (runCommands) {
    const cliVars = opts.vars ? parseVarsArg(opts.vars) : {};
    await resolveVariables(template, cliVars);
  } else {
    stripCommands(template.layout);
  }

  if (isHeadlessReattach) {
    const storedSessions = getSessionsForLayout(existingLayout!.name);
    const terminals = collectTerminalSurfaces(template.layout);
    for (let i = 0; i < terminals.length && i < storedSessions.length; i++) {
      terminals[i]!.session = storedSessions[i]!;
    }
    p.log.info(`Re-attaching headless layout with ${storedSessions.length} existing sessions`);
  }

  const sshSpinner = p.spinner();
  sshSpinner.start("Updating SSH config");
  await ensureSshConfig();
  sshSpinner.stop("SSH config updated");

  const { cmuxRef, sessions } = await buildCmuxLayout(layoutName, template, workspace.name);

  const noPorts = opts.noPorts ?? false;
  if (!noPorts && template.ports?.length) {
    startPortForwarding(workspace.name, template.ports);
  }

  saveLayout({
    name: layoutName,
    cmux_id: cmuxRef,
    coder_ws: workspace.name,
    template: template.name,
    type: template.type,
    path: projectPath,
  });

  for (const session of sessions) {
    recordSession(workspace.name, session.name, layoutName);
  }

  p.outro(
    `${pc.green("✓")} Layout ${pc.bold(layoutName)} attached — workspace ${pc.cyan(cmuxRef)}`,
  );
}

export const attachCommand = defineCommand({
  meta: {
    name: "attach",
    description: "Attach an existing Coder workspace to a new Cmux layout",
  },
  args: {
    workspace: {
      type: "positional",
      description: "Coder workspace name",
      required: false,
    },
    template: {
      type: "string",
      alias: "t",
      description: "Template name for layout",
    },
    "no-ports": {
      type: "boolean",
      description: "Skip port forwarding",
      default: false,
    },
    "run-commands": {
      type: "boolean",
      alias: "r",
      description: "Run template commands after attaching ZMX sessions (also enables variable prompts)",
      default: false,
    },
    vars: {
      type: "string",
      description: "Template variables as key=value pairs (e.g. --vars \"branch=main,port=3000\")",
    },
  },
  async run({ args }) {
    await requireCoderLogin();

    const workspace = await pickWorkspace({
      filter: args.workspace as string | undefined,
      message: "Select a running workspace to attach",
    });

    if (!workspace) {
      p.log.error("No workspace selected");
      process.exit(1);
    }

    await runAttach({
      ws: workspace,
      template: args.template as string | undefined,
      vars: args.vars as string | undefined,
      noPorts: args["no-ports"] as boolean,
      runCommands: args["run-commands"] as boolean,
    });
  },
});

/** Remove command and cwd from all terminal surfaces in a layout tree. Mutates in place. */
function stripCommands(node: LayoutNode): void {
  if (isPaneNode(node)) {
    for (const surface of node.pane.surfaces) {
      if (surface.type === "terminal") {
        delete surface.command;
        delete surface.cwd;
      }
    }
  } else if (isSplitNode(node)) {
    stripCommands(node.children[0]);
    stripCommands(node.children[1]);
  }
}
