import { defineCommand } from "citty";
import * as p from "@clack/prompts";
import pc from "picocolors";
import { saveConfig } from "../lib/config.ts";

export const initCommand = defineCommand({
  meta: {
    name: "init",
    description: "Initialize cmux-coder configuration",
  },
  async run() {
    p.intro(pc.bold("cmux-coder init"));

    // 1. Try auto-detect username from `coder whoami`
    let detectedUsername: string | null = null;
    try {
      const output = await Bun.$`coder whoami`.quiet().text();
      const match = output.match(/authenticated as (\S+)/);
      if (match) detectedUsername = match[1]!.replace(/[^a-zA-Z0-9_-]/g, "");
    } catch {}

    // 2. Confirm or prompt for username
    let username: string;
    if (detectedUsername) {
      const confirmed = await p.confirm({
        message: `Detected Coder username: ${pc.bold(detectedUsername)}. Use this?`,
      });
      if (p.isCancel(confirmed)) { p.cancel("Cancelled."); process.exit(0); }
      if (confirmed) {
        username = detectedUsername;
      } else {
        const input = await p.text({ message: "Coder username" });
        if (p.isCancel(input)) { p.cancel("Cancelled."); process.exit(0); }
        username = input;
      }
    } else {
      p.log.warn("Could not detect username from `coder whoami`");
      const input = await p.text({ message: "Coder username" });
      if (p.isCancel(input)) { p.cancel("Cancelled."); process.exit(0); }
      username = input;
    }

    // 3. Agent name (default "main")
    const agent = await p.text({ message: "Default agent name", placeholder: "main" });
    if (p.isCancel(agent)) { p.cancel("Cancelled."); process.exit(0); }

    await saveConfig({ username, agent: agent || "main" });
    p.outro(`Config saved to ${pc.dim("~/.config/cmux-coder/config.json")}`);
  },
});
