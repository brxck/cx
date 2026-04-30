import { homedir } from "os";
import { join } from "path";

const SSH_CONFIG = join(homedir(), ".ssh", "config");
const START_MARKER = "# --- START ZMX ---";
const END_MARKER = "LogLevel ERROR";

export function zmxBlock(coderPath: string): string {
  return `# --- START ZMX ---
# SSH config for Coder workspaces with ZMX session persistence.
#
# Plain SSH (no ZMX):
#   ssh main.portland.brockmcelroy.coder
#
# ZMX session (append session name):
#   ssh main.portland.brockmcelroy.coder.term   → ZMX session "term"
#   ssh main.portland.brockmcelroy.coder.irc    → ZMX session "irc"
#
# Sessions survive disconnects — reconnect to resume where you left off.
# ControlMaster reuses the SSH connection for near-instant reconnects.
#
# To remove: delete this block between START/END ZMX markers.
# --- END ZMX ---

# Plain Coder SSH — no ZMX, clean shell (used by cmux ssh, direct connections)
Match host *.coder,!coder-vscode.*
    ProxyCommand ${coderPath} ssh --stdio --hostname-suffix coder %h
    ControlPath ~/.ssh/cm-%C
    ControlMaster auto
    ControlPersist 10m
    ConnectTimeout 0
    StrictHostKeyChecking no
    UserKnownHostsFile /dev/null
    LogLevel ERROR

# ZMX session persistence — host has a session name suffix after .coder.
Match host *.coder.*,!coder-vscode.*
    ProxyCommand bash -c 'h=%h; exec ${coderPath} ssh --stdio --hostname-suffix coder "\${h%%.*}"'
    RemoteCommand session=%k; zmx attach "$(echo $session | sed 's/.*\\.//')"
    RequestTTY yes
    ControlPath ~/.ssh/cm-%C
    ControlMaster auto
    ControlPersist 10m
    ConnectTimeout 0
    StrictHostKeyChecking no
    UserKnownHostsFile /dev/null
    LogLevel ERROR`;
}

const CODER_MARKER = "# ------------START-CODER";

/** Resolve the absolute path to the coder binary. */
async function resolveCoderPath(): Promise<string> {
  try {
    const result = await Bun.$`which coder`.quiet().text();
    return result.trim();
  } catch {
    return "/usr/local/bin/coder";
  }
}

/** Check if the ZMX block is already present in ~/.ssh/config. */
export async function hasZmxBlock(): Promise<boolean> {
  const file = Bun.file(SSH_CONFIG);
  if (!(await file.exists())) return false;
  const content = await file.text();
  return content.includes(START_MARKER);
}

export type MergeResult =
  | { action: "noop" }
  | { action: "inserted"; content: string }
  | { action: "updated"; content: string };

/**
 * Pure merge: given the current ssh_config contents and the canonical ZMX block,
 * return the new contents (or noop if already current).
 *
 * Update path owns the whole ZMX region from START_MARKER through the last
 * `LogLevel ERROR` before the Coder-managed section (or EOF). Any number of
 * historical Match blocks in that region collapse back to the canonical template.
 */
export function mergeZmxBlock(content: string, block: string): MergeResult {
  if (content.includes(START_MARKER)) {
    const startIdx = content.indexOf(START_MARKER);
    const coderIdx = content.indexOf(CODER_MARKER, startIdx);
    const regionEnd = coderIdx === -1 ? content.length : coderIdx;
    const lastEnd = content.lastIndexOf(END_MARKER, regionEnd);
    if (lastEnd === -1 || lastEnd < startIdx) return { action: "noop" };
    const endIdx = lastEnd + END_MARKER.length;

    const existingBlock = content.slice(startIdx, endIdx);
    if (existingBlock === block) return { action: "noop" };

    const before = content.slice(0, startIdx);
    const after = content.slice(endIdx);
    return { action: "updated", content: before + block + after };
  }

  const coderIndex = content.indexOf(CODER_MARKER);
  if (coderIndex !== -1) {
    const before = content.slice(0, coderIndex);
    const after = content.slice(coderIndex);
    return { action: "inserted", content: before + block + "\n\n" + after };
  }
  return { action: "inserted", content: block + "\n\n" + content };
}

/**
 * Idempotently insert or update the ZMX Match blocks in ~/.ssh/config.
 * Returns "inserted" if added fresh, "updated" if replaced an older version, or false if already current.
 */
export async function ensureZmxBlock(): Promise<"inserted" | "updated" | false> {
  const sshDir = join(homedir(), ".ssh");
  await Bun.$`mkdir -p ${sshDir}`.quiet();

  const coderPath = await resolveCoderPath();
  const block = zmxBlock(coderPath);

  const file = Bun.file(SSH_CONFIG);
  const exists = await file.exists();
  const content = exists ? await file.text() : "";

  const result = mergeZmxBlock(content, block);
  if (result.action === "noop") return false;
  await Bun.write(SSH_CONFIG, result.content);
  return result.action;
}
