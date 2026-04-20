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
  listCoderTemplates,
  buildWorkspaceContext,
  getCoderUrl,
  type WorkspaceContext,
} from "../lib/coder.ts";
import {
  resolveTemplateSource,
  listTemplateSources,
  getProjectTemplateSources,
  prepareTemplate,
  templateDisplay,
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
  },
  async run({ args }) {
    await requireCoderLogin();

    // 1. Resolve source (project-local → named → interactive picker with default fallback)
    const { source, projectPath } = await resolveSourceOrDefault(args.template as string | undefined);

    // 2. Phase 1 — run the template fn / substitute JSON vars, get coder config + type
    const cliVars = args.vars ? parseVarsArg(args.vars as string) : {};
    const prepared = await prepareTemplate(source, { cliVars });

    let coderWsName = args.workspace as string | undefined;
    if (!coderWsName) {
      const name = await p.text({
        message: "Workspace name",
        placeholder: prepared.name,
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

    // 3. Create/start Coder workspace
    await ensureCoderWorkspace(coderWsName, prepared.coder);

    // 4. Phase 2 — finalize layout + ports, building workspace context on demand
    const template = await prepared.finalize({
      workspace: prepared.needsWorkspace ? await fetchWorkspaceContext(coderWsName) : undefined,
    });

    // 5. Ensure SSH config
    const sshSpinner = p.spinner();
    sshSpinner.start("Updating SSH config");
    await ensureSshConfig();
    sshSpinner.stop("SSH config updated");

    // 6. Port forwarding
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

    // 7. Build Cmux layout
    const { cmuxRef, sessions } = await buildCmuxLayout(layoutName, template, coderWsName);

    // 8. Save to store (must happen before recordSession due to FK constraint)
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

  if (!existing) {
    spinner.stop(`Creating workspace ${pc.bold(name)}`);
    await createWorkspace(name, coder.template, {
      params: coder.parameters,
      preset: coder.preset,
    });
    await waitForWorkspace(name);
    p.log.success(`Workspace ${pc.bold(name)} created and ready`);
    return;
  }

  const status = workspaceStatus(existing);
  if (status === "running") {
    spinner.stop(`Workspace ${pc.bold(name)} is already running`);
    return;
  }

  if (status === "stopped") {
    spinner.stop(`Starting workspace ${pc.bold(name)}`);
    await startWorkspace(name);
    await waitForWorkspace(name);
    p.log.success(`Workspace ${pc.bold(name)} started and ready`);
    return;
  }

  spinner.stop(`Workspace is ${status}, waiting for it to be ready`);
  await waitForWorkspace(name);
  p.log.success(`Workspace ${pc.bold(name)} is ready`);
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
  if (name) {
    if (name === "default") return buildDefaultSource("persistent");
    if (name === "default-ephemeral") return buildDefaultSource("ephemeral");
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
    source: TemplateSource | null;
    origin: "project" | "global" | "default";
    defaultType?: "persistent" | "ephemeral";
  };

  const entries: PickerEntry[] = [
    ...projectSources.map((s) => ({ source: s, origin: "project" as const })),
    ...globalSources.map((s) => ({ source: s, origin: "global" as const })),
    { source: null, origin: "default" as const, defaultType: "persistent" as const },
    { source: null, origin: "default" as const, defaultType: "ephemeral" as const },
  ];

  entries.sort((a, b) => {
    if (a.origin === "default" && b.origin === "default") {
      return a.defaultType === "persistent" ? -1 : 1;
    }
    if (a.origin === "default") return 1;
    if (b.origin === "default") return -1;
    return a.source!.name.localeCompare(b.source!.name);
  });

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

  if (picked.origin === "default") {
    return buildDefaultSource(picked.defaultType!);
  }

  return {
    source: picked.source!,
    projectPath: picked.origin === "project" ? (project?.projectPath ?? null) : null,
  };
}

function renderPickerLabel(entry: {
  source: TemplateSource | null;
  origin: "project" | "global" | "default";
  defaultType?: "persistent" | "ephemeral";
}): string {
  if (entry.origin === "default") {
    const name = entry.defaultType === "ephemeral" ? "default-ephemeral" : "default";
    return `${pc.bold(name)}  ${pc.dim("single pane")}  ${pc.dim(entry.defaultType!)}`;
  }
  const d = templateDisplay(entry.source!);
  const projectTag = entry.origin === "project" ? `  ${pc.dim("(project)")}` : "";
  if (d.dynamic) {
    return `${pc.bold(d.name)}  ${pc.dim("(dynamic)")}${projectTag}`;
  }
  return `${pc.bold(d.name)}  ${pc.dim(d.coderTemplate ?? "")}  ${pc.dim(d.type ?? "")}${projectTag}`;
}

async function buildDefaultSource(
  type: "persistent" | "ephemeral",
): Promise<{ source: TemplateSource; projectPath: null }> {
  const spinner = p.spinner();
  spinner.start("Loading Coder templates");
  const coderTemplates = await listCoderTemplates();
  spinner.stop(`Found ${coderTemplates.length} Coder template${coderTemplates.length === 1 ? "" : "s"}`);

  if (coderTemplates.length === 0) {
    p.log.error("No Coder templates available. Ask your admin to create one.");
    process.exit(1);
  }

  coderTemplates.sort((a, b) => a.name.localeCompare(b.name));

  const choice = await p.autocomplete({
    message: "Select a Coder template",
    options: coderTemplates.map((t) => ({
      value: t.name,
      label: `${pc.bold(t.name)}${t.description ? `  ${pc.dim(t.description)}` : ""}`,
    })),
    placeholder: "Type to filter",
  });

  if (p.isCancel(choice)) {
    p.cancel("Cancelled.");
    process.exit(0);
  }

  const config: TemplateConfig = {
    name: type === "ephemeral" ? "default-ephemeral" : "default",
    coder: { template: choice as string },
    type,
    layout: {
      pane: {
        surfaces: [{ type: "terminal" }],
      },
    },
  };

  return {
    source: { kind: "json", name: config.name, filePath: "<default>", config },
    projectPath: null,
  };
}
