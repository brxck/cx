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
  type CoderWorkspace,
} from "../lib/coder.ts";
import {
  resolveTemplate as resolveTemplateFromLib,
  listTemplatesAsync,
  getProjectTemplates,
  type TemplateConfig,
} from "../lib/templates.ts";
import { parseVarsArg, resolveVariables } from "../lib/variables.ts";
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

    // 1. Resolve template (project-local → named → interactive picker with default fallback)
    const { template, projectPath } = await resolveTemplateOrDefault(args.template as string | undefined);

    // Resolve template variables before anything consumes commands/URLs
    const cliVars = args.vars ? parseVarsArg(args.vars as string) : {};
    await resolveVariables(template, cliVars);

    let coderWsName = args.workspace as string | undefined;
    if (!coderWsName) {
      const name = await p.text({
        message: "Workspace name",
        placeholder: template.name,
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

    // 2. Create/start Coder workspace
    await ensureCoderWorkspace(coderWsName, template);

    // 3. Ensure SSH config
    const sshSpinner = p.spinner();
    sshSpinner.start("Updating SSH config");
    await ensureSshConfig();
    sshSpinner.stop("SSH config updated");

    // 4. Port forwarding
    const noPorts = args["no-ports"] as boolean;
    if (!noPorts && template.ports?.length) {
      startPortForwarding(coderWsName, template.ports);
    }

    if (args.headless) {
      // Headless: start ZMX sessions without a Cmux layout
      const sessions = await startHeadlessSessions(template, coderWsName);

      saveLayout({
        name: layoutName,
        cmux_id: "headless",
        coder_ws: coderWsName,
        template: template.name,
        type: template.type,
        path: projectPath,
      });

      for (const session of sessions) {
        recordSession(coderWsName, session.name, layoutName);
      }

      p.outro(`${pc.green("✓")} Headless layout ${pc.bold(layoutName)} — ${sessions.length} ZMX sessions started`);
      return;
    }

    // 5. Build Cmux layout
    const { cmuxRef, sessions } = await buildCmuxLayout(layoutName, template, coderWsName);

    // 6. Save to store (must happen before recordSession due to FK constraint)
    saveLayout({
      name: layoutName,
      cmux_id: cmuxRef,
      coder_ws: coderWsName,
      template: template.name,
      type: template.type,
      path: projectPath,
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
  template: TemplateConfig,
): Promise<void> {
  const spinner = p.spinner();
  spinner.start("Checking Coder workspace");

  const workspaces = await listCoderWorkspaces();
  const existing = workspaces.find((ws) => ws.name === name);

  if (!existing) {
    spinner.stop(`Creating workspace ${pc.bold(name)}`);
    await createWorkspace(name, template.coder.template, {
      params: template.coder.parameters,
      preset: template.coder.preset,
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

  // Starting, stopping, or other — wait for it
  spinner.stop(`Workspace is ${status}, waiting for it to be ready`);
  await waitForWorkspace(name);
  p.log.success(`Workspace ${pc.bold(name)} is ready`);
}

// ── Template resolution ──

async function resolveTemplateOrDefault(
  name: string | undefined,
): Promise<{ template: TemplateConfig; projectPath: string | null }> {
  if (name) {
    if (name === "default") return buildDefaultTemplate("persistent");
    if (name === "default-ephemeral") return buildDefaultTemplate("ephemeral");
    const resolved = await resolveTemplateFromLib({ name });
    if (!resolved) {
      p.log.error(`Template ${pc.bold(name)} not found`);
      process.exit(1);
    }
    return { template: resolved.template, projectPath: resolved.projectPath };
  }

  const project = await getProjectTemplates();
  const projectTemplates = project?.templates ?? [];
  const globalTemplates = await listTemplatesAsync();

  type PickerEntry = {
    template: TemplateConfig | null;
    source: "project" | "global" | "default";
    defaultType?: "persistent" | "ephemeral";
  };

  const entries: PickerEntry[] = [
    ...projectTemplates.map((t) => ({ template: t, source: "project" as const })),
    ...globalTemplates.map((t) => ({ template: t, source: "global" as const })),
    { template: null, source: "default" as const, defaultType: "persistent" as const },
    { template: null, source: "default" as const, defaultType: "ephemeral" as const },
  ];

  entries.sort((a, b) => {
    if (a.source === "default" && b.source === "default") {
      return a.defaultType === "persistent" ? -1 : 1;
    }
    if (a.source === "default") return 1;
    if (b.source === "default") return -1;
    return a.template!.name.localeCompare(b.template!.name);
  });

  const choice = await p.autocomplete({
    message: "Select a template",
    options: entries.map((e) => ({
      value: e,
      label:
        e.source === "default"
          ? `${pc.bold(e.defaultType === "ephemeral" ? "default-ephemeral" : "default")}  ${pc.dim("single pane")}  ${pc.dim(e.defaultType!)}`
          : `${pc.bold(e.template!.name)}  ${pc.dim(e.template!.coder.template)}  ${pc.dim(e.template!.type)}${e.source === "project" ? `  ${pc.dim("(project)")}` : ""}`,
    })),
    placeholder: "Type to filter",
  });

  if (p.isCancel(choice)) {
    p.cancel("Cancelled.");
    process.exit(0);
  }
  const picked = choice as PickerEntry;

  if (picked.source === "default") {
    return buildDefaultTemplate(picked.defaultType!);
  }

  return {
    template: picked.template!,
    projectPath: picked.source === "project" ? (project?.projectPath ?? null) : null,
  };
}

async function buildDefaultTemplate(
  type: "persistent" | "ephemeral",
): Promise<{ template: TemplateConfig; projectPath: null }> {
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

  return {
    template: {
      name: type === "ephemeral" ? "default-ephemeral" : "default",
      coder: { template: choice as string },
      type,
      layout: {
        pane: {
          surfaces: [{ type: "terminal" }],
        },
      },
    },
    projectPath: null,
  };
}
