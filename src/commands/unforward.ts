import { defineCommand } from "citty";
import * as p from "@clack/prompts";
import { consola } from "consola";
import pc from "picocolors";
import { getLayout, getLayoutsByPath } from "../lib/store.ts";
import { detectPortForwards, stopPortForwards } from "../lib/ports.ts";

export const unforwardCommand = defineCommand({
  meta: {
    name: "unforward",
    description: "Stop port forwarding for a layout",
  },
  args: {
    layout: {
      type: "positional",
      required: false,
      description: "Layout or workspace name",
    },
  },
  async run({ args }) {
    const running = await detectPortForwards();
    if (running.length === 0) {
      consola.info("No active port forwards");
      return;
    }

    let wsName: string;

    if (args.layout) {
      // Try as layout name first, then as workspace name
      const layout = getLayout(args.layout as string);
      wsName = layout?.coder_ws ?? (args.layout as string);
    } else {
      // Auto-detect from cwd
      const cwdLayouts = getLayoutsByPath(process.cwd());
      if (cwdLayouts.length === 1) {
        wsName = cwdLayouts[0]!.coder_ws;
      } else {
        // Pick from workspaces with active forwards
        const choice = await p.select({
          message: "Stop port forwarding for",
          options: running.map((r) => ({
            value: r.workspace,
            label: `${pc.bold(r.workspace)}  ${pc.dim(r.ports.join(", "))}`,
          })),
        });
        if (p.isCancel(choice)) process.exit(0);
        wsName = choice as string;
      }
    }

    const killed = await stopPortForwards(wsName);
    if (killed > 0) {
      consola.success(`Stopped port forwarding for ${pc.bold(wsName)}`);
    } else {
      consola.warn(`No port forwards found for ${wsName}`);
    }
  },
});
