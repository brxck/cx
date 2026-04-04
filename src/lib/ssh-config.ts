import { homedir } from "os";
import { join } from "path";

const SSH_CONFIG = join(homedir(), ".ssh", "config");
const START_MARKER = "# --- START ZMX ---";

const ZMX_BLOCK = `# --- START ZMX ---
# ZMX session persistence for Coder workspaces.
# Append a session name to your workspace SSH alias to attach to a ZMX session:
#
#   ssh main.portland.brockmcelroy.coder.term   → ZMX session "term"
#   ssh main.portland.brockmcelroy.coder.irc    → ZMX session "irc"
#   ssh main.portland.brockmcelroy.coder        → plain SSH, no ZMX
#
# Sessions survive disconnects — reconnect to resume where you left off.
# ControlMaster reuses the SSH connection for near-instant reconnects.
#
# To remove: delete this block between START/END ZMX markers.
# --- END ZMX ---
Match host *.coder.*,!coder-vscode.*
    ProxyCommand bash -c 'exec coder ssh --stdio --hostname-suffix coder "$(echo %h | sed "s/\\.[^.]*$//")"'
    RemoteCommand session=%k; zmx attach "$(echo $session | sed 's/.*\\.//')"
    RequestTTY yes
    ControlPath ~/.ssh/cm-%r@%h:%p
    ControlMaster auto
    ControlPersist 10m
    ConnectTimeout 0
    StrictHostKeyChecking no
    UserKnownHostsFile /dev/null
    LogLevel ERROR`;

const CODER_MARKER = "# ------------START-CODER";

/** Check if the ZMX block is already present in ~/.ssh/config. */
export async function hasZmxBlock(): Promise<boolean> {
  const file = Bun.file(SSH_CONFIG);
  if (!(await file.exists())) return false;
  const content = await file.text();
  return content.includes(START_MARKER);
}

/** Idempotently insert the ZMX Match block into ~/.ssh/config. */
export async function ensureZmxBlock(): Promise<boolean> {
  // Ensure ~/.ssh exists
  const sshDir = join(homedir(), ".ssh");
  await Bun.$`mkdir -p ${sshDir}`.quiet();

  const file = Bun.file(SSH_CONFIG);
  const exists = await file.exists();
  const content = exists ? await file.text() : "";

  if (content.includes(START_MARKER)) return false;

  let result: string;
  const coderIndex = content.indexOf(CODER_MARKER);

  if (coderIndex !== -1) {
    // Insert before the Coder-managed section
    const before = content.slice(0, coderIndex);
    const after = content.slice(coderIndex);
    result = before + ZMX_BLOCK + "\n\n" + after;
  } else {
    // No Coder section — prepend
    result = ZMX_BLOCK + "\n\n" + content;
  }

  await Bun.write(SSH_CONFIG, result);
  return true;
}
