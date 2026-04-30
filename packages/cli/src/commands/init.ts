import { defineCommand } from "citty";
import * as p from "@clack/prompts";
import pc from "picocolors";
import { saveConfig } from "../lib/config.ts";
import { ensureSshConfig } from "../lib/coder.ts";
import { ensureZmxBlock } from "../lib/ssh-config.ts";

export const initCommand = defineCommand({
  meta: {
    name: "init",
    description: "Initialize cx configuration",
  },
  async run() {
    p.intro(pc.bold("cx init"));

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

    await saveConfig({ username, agent: "main" });
    p.log.success(`Config saved to ${pc.dim("~/.config/cx/config.json")}`);

    // 4. Configure SSH for ZMX session persistence
    const s = p.spinner();
    s.start("Configuring SSH...");
    await ensureSshConfig();
    const zmxResult = await ensureZmxBlock();
    s.stop(
      zmxResult === "inserted" ? "SSH configured with ZMX session persistence"
      : zmxResult === "updated" ? "SSH config updated to latest format"
      : "SSH configured (already up to date)",
    );

    p.outro("Ready to go!");
  },
});
