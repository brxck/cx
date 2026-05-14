import { defineCommand } from "citty";
import * as p from "@clack/prompts";
import pc from "picocolors";
import {
  listWorkspaces as listCoderWorkspaces,
  workspaceStatus,
  createWorkspace,
  startWorkspace,
  waitForWorkspace,
  ensureSshConfig,
  requireCoderLogin,
  buildWorkspaceContext,
  getCoderUrl,
  type WorkspaceContext,
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
  type TemplateConfig,
} from "../lib/templates.ts";
import { parseVarsArg } from "../lib/variables.ts";
import { saveLayout, recordSession } from "../lib/store.ts";
import { buildCmuxLayout, startHeadlessSessions, startPortForwarding } from "../lib/layout-builder.ts";

export const upCommand = defineCommand({
  meta: {
    name: "up",
    description: "Create a Coder workspace and build a Cmux layout",
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
      description: "Template name",
    },
    "no-ports": {
      type: "boolean",
      description: "Skip port forwarding",
      default: false,
    },
    headless: {
      type: "boolean",
      alias: "H",
      description: "Start ZMX sessions without creating a Cmux layout",
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
  },
  async run({ args }) {
    await requireCoderLogin();

    // 1. Resolve source (project-local → named → interactive picker with default fallback)
    const { source, projectPath } = await resolveSourceOrDefault(args.template as string | undefined);

    // 2. Prompt for workspace name first, so the template fn can read it from context
    let coderWsName = args.workspace as string | undefined;
    if (!coderWsName) {
      const name = await p.text({
        message: "Workspace name",
        placeholder: source.name,
        validate: (v) => {
          if (!v?.trim()) return "Name is required";
        },
      });
      if (p.isCancel(name)) {
        p.cancel("Cancelled.");
        process.exit(0);
      }
      coderWsName = name;
    }
    const layoutName = coderWsName;

    p.intro(pc.bold(`cx up ${pc.cyan(layoutName)}`));

    // 3. Phase 1 — run the template fn / substitute JSON vars, get coder config + type
    const cliVars = args.vars ? parseVarsArg(args.vars as string) : {};
    const interactive = args.defaults ? false : undefined;
    const prepared = await prepareTemplate(source, { cliVars, workspaceName: coderWsName, interactive });

    // 4. Create/start Coder workspace
    await ensureCoderWorkspace(coderWsName, prepared.coder);

    // 5. Phase 2 — finalize layout + ports, building workspace context on demand
    const template = await prepared.finalize({
      workspace: prepared.needsWorkspace ? await fetchWorkspaceContext(coderWsName) : undefined,
    });

    // 6. Ensure SSH config
    const sshSpinner = p.spinner();
    sshSpinner.start("Updating SSH config");
    await ensureSshConfig();
    sshSpinner.stop("SSH config updated");

    // 7. Port forwarding
    const noPorts = args["no-ports"] as boolean;
    if (!noPorts && template.ports?.length) {
      startPortForwarding(coderWsName, template.ports);
    }

    if (args.headless) {
      const sessions = await startHeadlessSessions(template, coderWsName);

      saveLayout({
        name: layoutName,
        cmux_id: "headless",
        coder_ws: coderWsName,
        template: template.name,
        type: template.type,
        path: projectPath,
        vars: prepared.resolvedInputs,
      });

      for (const session of sessions) {
        recordSession(coderWsName, session.name, layoutName);
      }

      p.outro(`${pc.green("✓")} Headless layout ${pc.bold(layoutName)} — ${sessions.length} ZMX sessions started`);
      return;
    }

    // 8. Build Cmux layout
    const { cmuxRef, sessions } = await buildCmuxLayout(layoutName, template, coderWsName);

    // 9. Save to store (must happen before recordSession due to FK constraint)
    saveLayout({
      name: layoutName,
      cmux_id: cmuxRef,
      coder_ws: coderWsName,
      template: template.name,
      type: template.type,
      path: projectPath,
      vars: prepared.resolvedInputs,
    });

    for (const session of sessions) {
      recordSession(coderWsName, session.name, layoutName);
    }

    p.outro(
      `${pc.green("✓")} Layout ${pc.bold(layoutName)} is ready — workspace ${pc.cyan(cmuxRef)}`,
    );
  },
});

// ── Coder workspace lifecycle ──

async function ensureCoderWorkspace(
  name: string,
  coder: TemplateConfig["coder"],
): Promise<void> {
  const spinner = p.spinner();
  spinner.start("Checking Coder workspace");

  const workspaces = await listCoderWorkspaces();
  const existing = workspaces.find((ws) => ws.name === name);

  const status = existing ? workspaceStatus(existing) : null;

  if (existing && status === "running") {
    spinner.stop(`Workspace ${pc.bold(name)} is already running`);
    return;
  }

  try {
    if (!existing) {
      spinner.stop(`Creating ${pc.bold(name)}`);
      await createWorkspace(name, coder.template, {
        params: coder.parameters,
        preset: coder.preset,
      });
      const waitHeading = `Waiting for ${pc.bold(name)}`;
      spinner.start(waitHeading);
      await waitForWorkspace(name, undefined, (line) =>
        spinner.message(formatLogForSpinner(waitHeading, line)),
      );
      spinner.stop(`Workspace ${pc.bold(name)} created and ready`);
      return;
    }

    if (status === "stopped") {
      const heading = `Starting ${pc.bold(name)}`;
      spinner.message(heading);
      await startWorkspace(name, {
        onLine: (line) => spinner.message(formatLogForSpinner(heading, line)),
      });
      const waitHeading = `Waiting for ${pc.bold(name)}`;
      spinner.message(waitHeading);
      await waitForWorkspace(name, undefined, (line) =>
        spinner.message(formatLogForSpinner(waitHeading, line)),
      );
      spinner.stop(`Workspace ${pc.bold(name)} started and ready`);
      return;
    }

    const waitHeading = `Waiting for ${pc.bold(name)} (${status})`;
    spinner.message(waitHeading);
    await waitForWorkspace(name, undefined, (line) =>
      spinner.message(formatLogForSpinner(waitHeading, line)),
    );
    spinner.stop(`Workspace ${pc.bold(name)} is ready`);
  } catch (err) {
    spinner.error(`Failed to prepare workspace ${pc.bold(name)}`);
    await printCoderFailure(err, { workspace: name });
    throw err;
  }
}

async function fetchWorkspaceContext(name: string): Promise<WorkspaceContext> {
  const [workspaces, base] = await Promise.all([listCoderWorkspaces(), getCoderUrl()]);
  const ws = workspaces.find((w) => w.name === name);
  if (!ws) throw new Error(`Coder workspace "${name}" not found after ensure`);
  return buildWorkspaceContext(ws, base);
}

// ── Template resolution ──

async function resolveSourceOrDefault(
  name: string | undefined,
): Promise<{ source: TemplateSource; projectPath: string | null }> {
  await ensureDefaultsSeeded();

  if (name) {
    const resolved = await resolveTemplateSource({ name });
    if (!resolved) {
      p.log.error(`Template ${pc.bold(name)} not found`);
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
    options: entries.map((e) => ({
      value: e,
      label: renderPickerLabel(e),
    })),
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

function renderPickerLabel(entry: {
  source: TemplateSource;
  origin: "project" | "global";
}): string {
  const d = templateDisplay(entry.source);
  const projectTag = entry.origin === "project" ? `  ${pc.dim("(project)")}` : "";
  if (d.dynamic) {
    return `${pc.bold(d.name)}  ${pc.dim("(dynamic)")}${projectTag}`;
  }
  return `${pc.bold(d.name)}  ${pc.dim(d.coderTemplate ?? "")}  ${pc.dim(d.type ?? "")}${projectTag}`;
}
