import { describe, it, expect } from "bun:test";
import { mergeZmxBlock, zmxBlock } from "./ssh-config.ts";

const CODER_PATH = "/usr/local/bin/coder";
const BLOCK = zmxBlock(CODER_PATH);

const STALE_BLOCK = `# --- START ZMX ---
# old header
# --- END ZMX ---

Match host *.coder,!coder-vscode.*
    ProxyCommand /bin/false
    ControlPath ~/.ssh/cm-%r@%h:%p
    ControlMaster auto
    ControlPersist 10m
    ConnectTimeout 0
    StrictHostKeyChecking no
    UserKnownHostsFile /dev/null
    LogLevel ERROR

Match host *.coder.*,!coder-vscode.*
    ProxyCommand /bin/false
    RemoteCommand echo stale
    RequestTTY yes
    ControlPath ~/.ssh/cm-%r@%h:%p
    ControlMaster auto
    ControlPersist 10m
    ConnectTimeout 0
    StrictHostKeyChecking no
    UserKnownHostsFile /dev/null
    LogLevel ERROR`;

const CODER_SECTION = `# ------------START-CODER-----------
# managed by coder
Host coder.*
    LogLevel ERROR
`;

describe("zmxBlock template", () => {
  it("uses --hostname-suffix without the broken 4-segment sed regex", () => {
    expect(BLOCK).not.toContain("--ssh-host-prefix coder.");
    expect(BLOCK).not.toContain(`sed "s/^[^.]*\\.`);
  });

  it("escapes the bash %%.* expansion for ssh percent-expand", () => {
    // In the generated config, `%%` is the ssh escape for literal `%`.
    // The session-block ProxyCommand must carry `%%.*` so the shell sees `%.*`.
    expect(BLOCK).toContain(`"\${h%%.*}"`);
  });

  it("interpolates the resolved coder path", () => {
    expect(BLOCK).toContain(`${CODER_PATH} ssh --stdio --hostname-suffix coder %h`);
  });

  it("uses hashed ControlPath (%C) so sun_path stays under macOS's 104-byte cap", () => {
    expect(BLOCK).not.toContain("cm-%r@%h:%p");
    const matches = BLOCK.match(/ControlPath ~\/\.ssh\/cm-%C\b/g) ?? [];
    expect(matches.length).toBe(2);
  });
});

describe("mergeZmxBlock — fresh insert", () => {
  it("prepends into an empty file", () => {
    const r = mergeZmxBlock("", BLOCK);
    expect(r.action).toBe("inserted");
    if (r.action !== "inserted") throw new Error("unreachable");
    expect(r.content.startsWith(BLOCK)).toBe(true);
  });

  it("inserts before a Coder-managed section, preserving it", () => {
    const existing = `# Some prior content\n\n${CODER_SECTION}`;
    const r = mergeZmxBlock(existing, BLOCK);
    expect(r.action).toBe("inserted");
    if (r.action !== "inserted") throw new Error("unreachable");
    const blockIdx = r.content.indexOf(BLOCK);
    const coderIdx = r.content.indexOf("# ------------START-CODER");
    expect(blockIdx).toBeGreaterThan(-1);
    expect(coderIdx).toBeGreaterThan(blockIdx);
    expect(r.content).toContain("# Some prior content");
    expect(r.content).toContain(CODER_SECTION);
  });

  it("prepends when there is no Coder section", () => {
    const existing = `Host foo\n    HostName foo.example.com\n`;
    const r = mergeZmxBlock(existing, BLOCK);
    expect(r.action).toBe("inserted");
    if (r.action !== "inserted") throw new Error("unreachable");
    expect(r.content.startsWith(BLOCK)).toBe(true);
    expect(r.content).toContain("Host foo");
  });
});

describe("mergeZmxBlock — idempotent noop", () => {
  it("returns noop when block is already current (no Coder section)", () => {
    const existing = `${BLOCK}\n\nHost foo\n`;
    const r = mergeZmxBlock(existing, BLOCK);
    expect(r.action).toBe("noop");
  });

  it("returns noop when block is already current (with Coder section)", () => {
    const existing = `${BLOCK}\n\n${CODER_SECTION}`;
    const r = mergeZmxBlock(existing, BLOCK);
    expect(r.action).toBe("noop");
  });
});

describe("mergeZmxBlock — update", () => {
  it("replaces a stale block and preserves surrounding content", () => {
    const existing = `# preamble\n\n${STALE_BLOCK}\n\n${CODER_SECTION}`;
    const r = mergeZmxBlock(existing, BLOCK);
    expect(r.action).toBe("updated");
    if (r.action !== "updated") throw new Error("unreachable");
    expect(r.content.startsWith("# preamble\n\n")).toBe(true);
    expect(r.content).toContain(BLOCK);
    expect(r.content).toContain(CODER_SECTION);
    expect(r.content).not.toContain("echo stale");
    expect(r.content).not.toContain("/bin/false");
  });

  it("collapses duplicate Match blocks back to canonical template", () => {
    // Simulate the prior-bug output: two session Match blocks.
    const duplicated = STALE_BLOCK + `\n\nMatch host *.coder.*,!coder-vscode.*
    ProxyCommand /bin/false
    RemoteCommand echo duplicated
    RequestTTY yes
    ControlPath ~/.ssh/cm-%r@%h:%p
    ControlMaster auto
    ControlPersist 10m
    ConnectTimeout 0
    StrictHostKeyChecking no
    UserKnownHostsFile /dev/null
    LogLevel ERROR`;
    const existing = `${duplicated}\n\n${CODER_SECTION}`;

    const r = mergeZmxBlock(existing, BLOCK);
    expect(r.action).toBe("updated");
    if (r.action !== "updated") throw new Error("unreachable");

    // Extract our region (up to the Coder marker) and count.
    const region = r.content.slice(0, r.content.indexOf("# ------------START-CODER"));
    const plainMatches = region.match(/Match host \*\.coder,/g) ?? [];
    const sessionMatches = region.match(/Match host \*\.coder\.\*,/g) ?? [];
    expect(plainMatches.length).toBe(1);
    expect(sessionMatches.length).toBe(1);
    expect(region).not.toContain("echo duplicated");
    expect(region).not.toContain("echo stale");
  });

  it("handles stale block at EOF (no Coder section)", () => {
    const existing = `# preamble\n\n${STALE_BLOCK}\n`;
    const r = mergeZmxBlock(existing, BLOCK);
    expect(r.action).toBe("updated");
    if (r.action !== "updated") throw new Error("unreachable");
    expect(r.content).toContain(BLOCK);
    expect(r.content).not.toContain("echo stale");
    expect(r.content.startsWith("# preamble\n\n")).toBe(true);
  });

  it("uses last LogLevel ERROR before Coder section, not one inside it", () => {
    // The Coder-managed section also contains `LogLevel ERROR` — make sure we
    // don't swallow it into our region.
    const existing = `${STALE_BLOCK}\n\n${CODER_SECTION}`;
    const r = mergeZmxBlock(existing, BLOCK);
    expect(r.action).toBe("updated");
    if (r.action !== "updated") throw new Error("unreachable");
    expect(r.content).toContain(CODER_SECTION);
    expect(r.content).toContain("Host coder.*");
  });
});
