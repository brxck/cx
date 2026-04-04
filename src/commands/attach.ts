import { defineCommand } from "citty";
import * as p from "@clack/prompts";
import pc from "picocolors";
import { ensureSshConfig, workspaceStatus } from "../lib/coder.ts";
import {
  resolveTemplate,
  generateCmuxCommand,
  writeCmuxJson,
  type TemplateConfig,
} from "../lib/templates.ts";
import { saveLayout } from "../lib/store.ts";
import { buildCmuxLayout, startPortForwarding } from "../lib/layout-builder.ts";
import { pickWorkspace } from "../lib/workspace-picker.ts";

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
  },
  async run({ args }) {
    // 1. Pick Coder workspace
    const workspace = await pickWorkspace({
      filter: args.workspace as string | undefined,
      message: "Select a running workspace to attach",
    });

    if (!workspace) {
      p.log.error("No workspace selected");
      process.exit(1);
    }

    const status = workspaceStatus(workspace);
    if (status !== "running") {
      p.log.error(
        `Workspace ${pc.bold(workspace.name)} is ${status} — it must be running to attach`,
      );
      process.exit(1);
    }

    const layoutName = workspace.name;

    p.intro(pc.bold(`cmux-coder attach ${pc.cyan(layoutName)}`));

    // 2. Resolve template
    let template: TemplateConfig;
    let projectPath: string | null = null;

    const resolved = await resolveTemplate({
      name: args.template as string | undefined,
    });

    if (resolved) {
      template = resolved.template;
      projectPath = resolved.projectPath;
    } else {
      // Default single-pane layout
      p.log.info("No template found — using default single-pane layout");
      template = {
        name: "default",
        coder: { template: workspace.template_name },
        type: "persistent",
        layout: {
          pane: {
            surfaces: [{ type: "terminal" }],
          },
        },
      };
    }

    // 3. Ensure SSH config
    const sshSpinner = p.spinner();
    sshSpinner.start("Updating SSH config");
    await ensureSshConfig();
    sshSpinner.stop("SSH config updated");

    // 4. Build Cmux layout
    const cmuxRef = await buildCmuxLayout(layoutName, template, workspace.name);

    // 5. Port forwarding
    const noPorts = args["no-ports"] as boolean;
    if (!noPorts && template.ports?.length) {
      startPortForwarding(workspace.name, template.ports);
    }

    // 6. Save to store
    saveLayout({
      name: layoutName,
      cmux_id: cmuxRef,
      coder_ws: workspace.name,
      template: template.name,
      type: template.type,
      path: projectPath,
    });

    // 7. Generate cmux.json
    const cmd = generateCmuxCommand(template, workspace.name);
    await writeCmuxJson([cmd]);

    p.outro(
      `${pc.green("✓")} Layout ${pc.bold(layoutName)} attached — workspace ${pc.cyan(cmuxRef)}`,
    );
  },
});
