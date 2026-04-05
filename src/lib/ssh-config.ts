import { homedir } from "os";
import { join } from "path";

const SSH_CONFIG = join(homedir(), ".ssh", "config");
const START_MARKER = "# --- START ZMX ---";
const END_MARKER = "LogLevel ERROR";

const ZMX_BLOCK = `# --- START ZMX ---
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
    ProxyCommand bash -c 'ws=$(echo %h | sed "s/^[^.]*\\.\\([^.]*\\).*/\\1/"); exec coder ssh --stdio --ssh-host-prefix coder. "coder.$ws"'
    ControlPath ~/.ssh/cm-%r@%h:%p
    ControlMaster auto
    ControlPersist 10m
    ConnectTimeout 0
    StrictHostKeyChecking no
    UserKnownHostsFile /dev/null
    LogLevel ERROR

# ZMX session persistence — host has a session name suffix after .coder.
Match host *.coder.*,!coder-vscode.*
    ProxyCommand bash -c 'ws=$(echo %h | sed "s/^[^.]*\\.\\([^.]*\\).*/\\1/"); exec coder ssh --stdio --ssh-host-prefix coder. "coder.$ws"'
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

/**
 * Idempotently insert or update the ZMX Match blocks in ~/.ssh/config.
 * Returns "inserted" if added fresh, "updated" if replaced an older version, or false if already current.
 */
export async function ensureZmxBlock(): Promise<"inserted" | "updated" | false> {
  // Ensure ~/.ssh exists
  const sshDir = join(homedir(), ".ssh");
  await Bun.$`mkdir -p ${sshDir}`.quiet();

  const file = Bun.file(SSH_CONFIG);
  const exists = await file.exists();
  const content = exists ? await file.text() : "";

  if (content.includes(START_MARKER)) {
    // Block exists — check if it needs updating
    const startIdx = content.indexOf(START_MARKER);
    // Find the last END_MARKER after the start marker (end of the last Match block)
    const afterStart = content.indexOf(END_MARKER, startIdx);
    if (afterStart === -1) return false;
    // There may be two Match blocks; find the final END_MARKER
    let endIdx = afterStart;
    let searchFrom = afterStart + END_MARKER.length;
    const nextMarkerOrCoder = content.indexOf("\n#", searchFrom);
    const nextEnd = content.indexOf(END_MARKER, searchFrom);
    if (nextEnd !== -1 && (nextMarkerOrCoder === -1 || nextEnd < nextMarkerOrCoder)) {
      endIdx = nextEnd;
    }
    const existingBlock = content.slice(startIdx, endIdx + END_MARKER.length);
    if (existingBlock === ZMX_BLOCK) return false;

    // Replace the old block
    const before = content.slice(0, startIdx);
    const after = content.slice(endIdx + END_MARKER.length);
    await Bun.write(SSH_CONFIG, before + ZMX_BLOCK + after);
    return "updated";
  }

  // Fresh insert
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
  return "inserted";
}
