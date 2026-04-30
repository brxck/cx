import { describe, it, expect } from "bun:test";
import { parseSidebarState } from "./cmux.ts";

describe("parseSidebarState", () => {
  it("parses git branch", () => {
    const state = parseSidebarState("git_branch=main");
    expect(state.gitBranch).toBe("main");
    expect(state.gitDirty).toBe(false);
  });

  it("parses dirty branch", () => {
    const state = parseSidebarState("git_branch=feature dirty");
    expect(state.gitBranch).toBe("feature");
    expect(state.gitDirty).toBe(true);
  });

  it("parses cwd", () => {
    const state = parseSidebarState("cwd=/home/user/project");
    expect(state.cwd).toBe("/home/user/project");
  });

  it("parses PR with URL", () => {
    const state = parseSidebarState("pr=#42 open https://github.com/org/repo/pull/42");
    expect(state.pr).toBe("#42 open");
    expect(state.prUrl).toBe("https://github.com/org/repo/pull/42");
  });

  it("handles none values", () => {
    const state = parseSidebarState("git_branch=none\ncwd=none");
    expect(state.gitBranch).toBeNull();
    expect(state.cwd).toBeNull();
  });

  it("parses claude_code status", () => {
    const state = parseSidebarState("claude_code=active session123");
    expect(state.claudeStatus).toBe("active");
  });

  it("parses ports", () => {
    const state = parseSidebarState("ports=8080,3000");
    expect(state.ports).toBe("8080,3000");
  });

  it("returns defaults for empty input", () => {
    const state = parseSidebarState("");
    expect(state.gitBranch).toBeNull();
    expect(state.gitDirty).toBe(false);
    expect(state.pr).toBeNull();
    expect(state.prUrl).toBeNull();
    expect(state.claudeStatus).toBeNull();
    expect(state.cwd).toBeNull();
    expect(state.ports).toBeNull();
  });
});
