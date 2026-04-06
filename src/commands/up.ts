import { defineCommand } from "citty";
import { consola } from "consola";
import * as p from "@clack/prompts";
import pc from "picocolors";
import {
  listWorkspaces as listCoderWorkspaces,
  workspaceStatus,
  createWorkspace,
  startWorkspace,
  waitForWorkspace,
  ensureSshConfig,
  type CoderWorkspace,
} from "../lib/coder.ts";
import {
  resolveTemplate as resolveTemplateFromLib,
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
    // 1. Resolve template (project-local → named → interactive picker)
    const resolved = await resolveTemplateFromLib({
      name: args.template as string | undefined,
    });
    if (!resolved) {
      consola.error("No template found. Create one at ~/.config/cx/templates/ or add a cx.json to your project.");
      process.exit(1);
    }
    const { template, projectPath } = resolved;

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

