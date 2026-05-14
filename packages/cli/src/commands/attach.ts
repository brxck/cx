import { defineCommand } from "citty";
import * as p from "@clack/prompts";
import pc from "picocolors";
import {
  ensureSshConfig,
  workspaceStatus,
  requireCoderLogin,
  startWorkspace,
  waitForWorkspace,
  buildWorkspaceContext,
  getCoderUrl,
  type CoderWorkspace,
} from "../lib/coder.ts";
import { formatLogForSpinner, printCoderFailure } from "../lib/coder-ui.ts";
import {
  resolveTemplateSource,
  listTemplateSources,
  getProjectTemplateSources,
  prepareTemplate,
  templateDisplay,
  ensureDefaultsSeeded,
  type TemplateSource,
} from "../lib/templates.ts";
import { parseVarsArg } from "../lib/variables.ts";
import { saveLayout, getLayout, getSessionsForLayout, recordSession } from "../lib/store.ts";
import { buildCmuxLayout, startPortForwarding, collectTerminalSurfaces, stripCommands } from "../lib/layout-builder.ts";
import { pickWorkspace } from "../lib/workspace-picker.ts";

export interface RunAttachOpts {
  ws: CoderWorkspace;
  template?: string;
  vars?: string;
  noPorts?: boolean;
  runCommands?: boolean;
  defaults?: boolean;
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
      const startHeading = `Starting ${pc.bold(workspace.name)}`;
      spinner.start(startHeading);
      try {
        await startWorkspace(workspace.name, {
          onLine: (line) => spinner.message(formatLogForSpinner(startHeading, line)),
        });
        const waitHeading = `Waiting for ${pc.bold(workspace.name)}`;
        spinner.message(waitHeading);
        await waitForWorkspace(workspace.name, undefined, (line) =>
          spinner.message(formatLogForSpinner(waitHeading, line)),
        );
        spinner.stop(`Workspace ${pc.bold(workspace.name)} started and ready`);
      } catch (err) {
        spinner.error(`Failed to start workspace ${pc.bold(workspace.name)}`);
        await printCoderFailure(err, { workspace: workspace.name });
        throw err;
      }
    } else {
      p.log.error(
        `Workspace ${pc.bold(workspace.name)} is ${status} — it must be running to attach`,
      );
      process.exit(1);
    }
  }

  const layoutName = workspace.name;

  p.intro(pc.bold(`cx attach ${pc.cyan(layoutName)}`));

  const existingLayout = getLayout(layoutName);
  const isHeadlessReattach = existingLayout?.cmux_id === "headless";

  const { source, projectPath } = await resolveAttachSource(opts.template, workspace.template_name);

  const runCommands = opts.runCommands ?? false;

  const cliVars = opts.vars ? parseVarsArg(opts.vars) : {};
  const interactive = opts.defaults ? false : undefined;
  const prepared = await prepareTemplate(source, { cliVars, workspaceName: workspace.name, interactive });

  const wsContext = prepared.needsWorkspace
    ? buildWorkspaceContext(workspace, await getCoderUrl())
    : undefined;
  const template = await prepared.finalize({ workspace: wsContext });

  if (!runCommands) {
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
    vars: prepared.resolvedInputs,
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
      description: "Run template commands after attaching",
      default: false,
    },
    vars: {
      type: "string",
      description: "Template variables as key=value pairs (e.g. --vars \"branch=main,port=3000\")",
    },
    defaults: {
      type: "boolean",
      alias: "d",
      description: "Skip template input prompts and use defaults",
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
    await requireCoderLogin();

    const workspace = await pickWorkspace({
      filter: args.workspace as string | undefined,
      message: "Select a workspace to attach",
      showStopped: args.all as boolean,
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
      defaults: args.defaults as boolean,
    });
  },
});

async function resolveAttachSource(
  templateName: string | undefined,
  coderTemplate: string,
): Promise<{ source: TemplateSource; projectPath: string | null }> {
  await ensureDefaultsSeeded({ defaultCoderTemplate: coderTemplate });

  if (templateName) {
    const resolved = await resolveTemplateSource({ name: templateName });
    if (!resolved) {
      p.log.error(`Template ${pc.bold(templateName)} not found`);
      process.exit(1);
    }
    return { source: resolved.source, projectPath: resolved.projectPath };
  }

  const project = await getProjectTemplateSources();
  const projectSources = project?.sources ?? [];
  const globalSources = await listTemplateSources();

  type PickerEntry = {
    source: TemplateSource;
    origin: "project" | "global";
  };
  const entries: PickerEntry[] = [
    ...projectSources.map((s) => ({ source: s, origin: "project" as const })),
    ...globalSources.map((s) => ({ source: s, origin: "global" as const })),
  ];

  entries.sort((a, b) => a.source.name.localeCompare(b.source.name));

  const choice = await p.autocomplete({
    message: "Select a template",
    options: entries.map((e) => {
      const d = templateDisplay(e.source);
      const projectTag = e.origin === "project" ? `  ${pc.dim("(project)")}` : "";
      if (d.dynamic) {
        return {
          value: e,
          label: `${pc.bold(d.name)}  ${pc.dim("(dynamic)")}${projectTag}`,
        };
      }
      return {
        value: e,
        label: `${pc.bold(d.name)}  ${pc.dim(d.coderTemplate ?? "")}  ${pc.dim(d.type ?? "")}${projectTag}`,
      };
    }),
    placeholder: "Type to filter",
  });

  if (p.isCancel(choice)) {
    p.cancel("Cancelled.");
    process.exit(0);
  }

  const picked = choice as PickerEntry;
  return {
    source: picked.source,
    projectPath: picked.origin === "project" ? (project?.projectPath ?? null) : null,
  };
}

