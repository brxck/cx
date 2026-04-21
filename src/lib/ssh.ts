import { consola } from "consola";
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

let _autosshAvailable: boolean | null = null;

async function hasAutossh(): Promise<boolean> {
  if (_autosshAvailable !== null) return _autosshAvailable;
  try {
    await Bun.$`command -v autossh`.quiet();
    _autosshAvailable = true;
  } catch {
    _autosshAvailable = false;
    consola.warn(
      "autossh not found on PATH — pane SSH will not auto-reconnect. brew install autossh.",
    );
  }
  return _autosshAvailable;
}

/**
 * Build the shell command for an interactive pane SSH. Callers pass a fully
 * qualified host (typically via `sshHostWithSession`) so the SSH Match block
 * can fire its `RemoteCommand zmx attach` on every (re)connect.
 */
export async function buildInteractiveSshCommand(host: string): Promise<string> {
  if (await hasAutossh()) {
    return `AUTOSSH_GATETIME=0 autossh -M 0 -o ServerAliveInterval=15 -o ServerAliveCountMax=3 ${host}`;
  }
  return `ssh ${host}`;
}
