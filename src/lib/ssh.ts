import { loadConfig, type Config } from "./config.ts";

let _config: Config | null = null;

async function getConfig(): Promise<Config> {
  if (!_config) _config = await loadConfig();
  return _config;
}

/** {agent}.{workspace}.{username}.coder */
export async function sshHost(workspace: string): Promise<string> {
  const c = await getConfig();
  return `${c.agent ?? "main"}.${workspace}.${c.username}.coder`;
}

/** {agent}.{workspace}.{username}.coder.{session} */
export async function sshHostWithSession(workspace: string, session: string): Promise<string> {
  const c = await getConfig();
  return `${c.agent ?? "main"}.${workspace}.${c.username}.coder.${session}`;
}
