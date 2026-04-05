import { defineCommand } from "citty";
import { consola } from "consola";
import pc from "picocolors";
import { getLayout, getLayoutsByPath } from "../lib/store.ts";
import { getTemplate } from "../lib/templates.ts";
import { detectPortForwards } from "../lib/ports.ts";
import { startPortForwarding } from "../lib/layout-builder.ts";
import { pickLayout } from "../lib/workspace-picker.ts";

export const forwardCommand = defineCommand({
  meta: { name: "forward", description: "Start port forwarding for a layout" },
  args: {
    layout: {
      type: "positional",
      required: false,
      description: "Layout name",
    },
  },
  async run({ args }) {
    // 1. Resolve layout (by name, by cwd, or picker)
    let layout = args.layout
      ? getLayout(args.layout as string)
      : null;

    if (!layout && !args.layout) {
      const cwdLayouts = getLayoutsByPath(process.cwd());
      if (cwdLayouts.length === 1) {
        layout = cwdLayouts[0]!;
      } else {
        const picked = await pickLayout({ message: "Forward ports for" });
        if (!picked) {
          consola.info("No layout selected");
          return;
        }
        layout = picked;
      }
    }

    if (!layout) {
      consola.error(`Layout "${args.layout}" not found`);
      process.exit(1);
    }

    // 2. Load template to get port config
    const template = layout.template
      ? await getTemplate(layout.template)
      : null;
    const ports = template?.ports;
    if (!ports?.length) {
      consola.warn(
        `No ports configured in template for ${pc.bold(layout.name)}`,
      );
      return;
    }

    // 3. Check for already-running forwards
    const running = await detectPortForwards();
    const existing = running.filter((p) => p.workspace === layout!.coder_ws);
    if (existing.length > 0) {
      const existingPorts = existing.flatMap((p) => p.ports);
      consola.info(`Already forwarding: ${existingPorts.join(", ")}`);
      const newPorts = ports.filter((p) => !existingPorts.includes(p));
      if (newPorts.length === 0) {
        consola.info("All ports already forwarded");
        return;
      }
      startPortForwarding(layout.coder_ws, newPorts);
    } else {
      startPortForwarding(layout.coder_ws, ports);
    }
  },
});
