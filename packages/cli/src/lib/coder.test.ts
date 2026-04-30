import { describe, it, expect } from "bun:test";
import { relativeTime, dashboardUrl, workspaceStatus, listOpenableApps, type CoderWorkspace } from "./coder.ts";

describe("relativeTime", () => {
  it("returns seconds for recent timestamps", () => {
    const iso = new Date(Date.now() - 30_000).toISOString();
    expect(relativeTime(iso)).toMatch(/^\d+s$/);
  });

  it("returns minutes", () => {
    const iso = new Date(Date.now() - 5 * 60_000).toISOString();
    expect(relativeTime(iso)).toMatch(/^\d+m$/);
  });

  it("returns hours", () => {
    const iso = new Date(Date.now() - 3 * 3_600_000).toISOString();
    expect(relativeTime(iso)).toMatch(/^\d+h$/);
  });

  it("returns days", () => {
    const iso = new Date(Date.now() - 2 * 86_400_000).toISOString();
    expect(relativeTime(iso)).toMatch(/^\d+d$/);
  });
});

describe("dashboardUrl", () => {
  it("formats correctly", () => {
    expect(dashboardUrl("https://coder.dev", "alice", "myws")).toBe(
      "https://coder.dev/@alice/myws",
    );
  });
});

function makeWorkspace(overrides: {
  status: string;
  transition: string;
  resources?: CoderWorkspace["latest_build"]["resources"];
}): CoderWorkspace {
  return {
    id: "test",
    name: "test",
    owner_name: "owner",
    organization_name: "org",
    template_name: "tmpl",
    outdated: false,
    latest_build: {
      status: overrides.status,
      transition: overrides.transition,
      created_at: new Date().toISOString(),
      template_version_name: "v1",
      resources: overrides.resources ?? [],
    },
    health: { healthy: true },
  } as CoderWorkspace;
}

describe("workspaceStatus", () => {
  it("returns running for running+start", () => {
    expect(workspaceStatus(makeWorkspace({ status: "running", transition: "start" }))).toBe("running");
  });

  it("returns stopped for running+stop", () => {
    expect(workspaceStatus(makeWorkspace({ status: "running", transition: "stop" }))).toBe("stopped");
  });

  it("returns stopped for succeeded+stop", () => {
    expect(workspaceStatus(makeWorkspace({ status: "succeeded", transition: "stop" }))).toBe("stopped");
  });

  it("returns starting", () => {
    expect(workspaceStatus(makeWorkspace({ status: "starting", transition: "start" }))).toBe("starting");
  });

  it("returns stopping", () => {
    expect(workspaceStatus(makeWorkspace({ status: "stopping", transition: "stop" }))).toBe("stopping");
  });

  it("returns failed", () => {
    expect(workspaceStatus(makeWorkspace({ status: "failed", transition: "start" }))).toBe("failed");
  });

  it("falls back to stopped for unknown+stop", () => {
    expect(workspaceStatus(makeWorkspace({ status: "unknown", transition: "stop" }))).toBe("stopped");
  });

  it("falls back to running for unknown+start", () => {
    expect(workspaceStatus(makeWorkspace({ status: "unknown", transition: "start" }))).toBe("running");
  });

  it("returns other for unknown+delete", () => {
    expect(workspaceStatus(makeWorkspace({ status: "unknown", transition: "delete" }))).toBe("other");
  });
});

describe("listOpenableApps", () => {
  it("always includes dashboard", () => {
    const ws = makeWorkspace({ status: "running", transition: "start" });
    const apps = listOpenableApps(ws);
    expect(apps[0]).toEqual({ slug: "dashboard", label: "Dashboard" });
  });

  it("includes vscode when display_apps has it", () => {
    const ws = makeWorkspace({
      status: "running",
      transition: "start",
      resources: [{ agents: [{ id: "a1", name: "main", status: "connected", lifecycle_state: "ready", display_apps: ["vscode"] }] }],
    });
    const apps = listOpenableApps(ws);
    expect(apps.some((a) => a.slug === "vscode")).toBe(true);
  });

  it("includes non-hidden apps", () => {
    const ws = makeWorkspace({
      status: "running",
      transition: "start",
      resources: [{
        agents: [{
          id: "a1", name: "main", status: "connected", lifecycle_state: "ready",
          apps: [{ slug: "jupyter", display_name: "Jupyter", hidden: false }],
        }],
      }],
    });
    const apps = listOpenableApps(ws);
    expect(apps.some((a) => a.slug === "jupyter")).toBe(true);
  });

  it("excludes hidden apps", () => {
    const ws = makeWorkspace({
      status: "running",
      transition: "start",
      resources: [{
        agents: [{
          id: "a1", name: "main", status: "connected", lifecycle_state: "ready",
          apps: [{ slug: "secret", display_name: "Secret", hidden: true }],
        }],
      }],
    });
    const apps = listOpenableApps(ws);
    expect(apps.some((a) => a.slug === "secret")).toBe(false);
  });
});
