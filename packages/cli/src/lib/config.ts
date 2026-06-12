import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, mkdirSync } from "node:fs";

const CONFIG_DIR = join(homedir(), ".config", "cx");
const CONFIG_PATH = join(CONFIG_DIR, "config.json");

/** Default color applied to every cx-created Cmux workspace, unless overridden. */
export const DEFAULT_WORKSPACE_COLOR = "#3b82f6";

export interface Config {
  username: string;
  agent?: string;
  cmuxSsh?: boolean;
  /** Hex color applied to cx-created workspaces. Falls back to DEFAULT_WORKSPACE_COLOR. */
  defaultColor?: string;
}

export async function loadConfig(): Promise<Config> {
  if (!existsSync(CONFIG_PATH)) {
    throw new Error(
      `Config not found at ${CONFIG_PATH}\nRun: cx init`,
    );
  }
  return Bun.file(CONFIG_PATH).json() as Promise<Config>;
}

export async function saveConfig(config: Config): Promise<void> {
  mkdirSync(CONFIG_DIR, { recursive: true });
  await Bun.write(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n");
}
