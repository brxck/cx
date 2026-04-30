import { describe, it, expect, mock, beforeEach } from "bun:test";
import type { CoderWorkspace } from "../lib/coder.ts";
import { workspaceStatus, relativeTime } from "../lib/coder.ts";

function makeWorkspace(
  name: string,
  status: string,
  transition: string,
): CoderWorkspace {
  return {
    id: name,
    name,
    owner_name: "owner",
    organization_name: "org",
    template_name: "tmpl",
    outdated: false,
    latest_build: {
      status,
      transition,
      created_at: new Date(Date.now() - 86_400_000).toISOString(),
      template_version_name: "v1",
      resources: [],
    },
    health: { healthy: true, failing_agents: [] },
  };
}

const stoppedWs1 = makeWorkspace("stopped-1", "succeeded", "stop");
const stoppedWs2 = makeWorkspace("stopped-2", "running", "stop");
const runningWs = makeWorkspace("running-1", "running", "start");
const startingWs = makeWorkspace("starting-1", "starting", "start");
const failedWs = makeWorkspace("failed-1", "failed", "start");

const mockDeleteWorkspace = mock<(name: string, opts?: any) => Promise<void>>(
  () => Promise.resolve(),
);
const mockCloseWorkspace = mock<(id: string) => Promise<void>>(
  () => Promise.resolve(),
);
const mockRemoveLayout = mock<(name: string) => boolean>(() => true);
const mockGetLayouts = mock<(name: string) => any[]>(() => []);
const mockConfirm = mock<(opts: any) => Promise<boolean | symbol>>(
  () => Promise.resolve(true),
);
const mockLoadWorkspaces = mock(() => ({
  cached: null,
  fresh: Promise.resolve([
    stoppedWs1,
    stoppedWs2,
    runningWs,
    startingWs,
    failedWs,
  ]),
}));

mock.module("../lib/coder.ts", () => ({
  deleteWorkspace: mockDeleteWorkspace,
  requireCoderLogin: () => Promise.resolve(),
  workspaceStatus,
  relativeTime,
}));

mock.module("../lib/workspace-cache.ts", () => ({
  loadWorkspaces: mockLoadWorkspaces,
}));

mock.module("../lib/coder-ui.ts", () => ({
  formatLogForSpinner: (_h: string, line: string) => line,
  printCoderFailure: () => Promise.resolve(),
}));

mock.module("../lib/cmux.ts", () => ({
  closeWorkspace: mockCloseWorkspace,
}));

mock.module("../lib/store.ts", () => ({
  getLayoutsByCoderWorkspace: mockGetLayouts,
  removeLayout: mockRemoveLayout,
}));

mock.module("@clack/prompts", () => ({
  spinner: () => ({
    start: () => {},
    stop: () => {},
    message: () => {},
    error: () => {},
  }),
  confirm: mockConfirm,
  isCancel: (v: unknown) => v === Symbol.for("cancel"),
  log: {
    info: () => {},
    message: () => {},
    success: () => {},
    warn: () => {},
    error: () => {},
  },
  intro: () => {},
  outro: () => {},
  cancel: () => {},
}));

const { runPrune } = await import("./prune.ts");

beforeEach(() => {
  mockDeleteWorkspace.mockClear();
  mockCloseWorkspace.mockClear();
  mockRemoveLayout.mockClear();
  mockGetLayouts.mockClear();
  mockConfirm.mockClear();
  mockLoadWorkspaces.mockClear();

  mockDeleteWorkspace.mockImplementation(() => Promise.resolve());
  mockLoadWorkspaces.mockImplementation(() => ({
    cached: null,
    fresh: Promise.resolve([
      stoppedWs1,
      stoppedWs2,
      runningWs,
      startingWs,
      failedWs,
    ]),
  }));
  mockGetLayouts.mockImplementation(() => []);
  mockConfirm.mockImplementation(() => Promise.resolve(true));
});

describe("runPrune", () => {
  it("deletes all stopped workspaces and tears down layouts", async () => {
    mockGetLayouts.mockImplementation((name: string) => {
      if (name === "stopped-1")
        return [{ name: "layout-1", cmux_id: "cmux-1" }];
      return [];
    });

    await runPrune({ yes: true });

    expect(mockDeleteWorkspace).toHaveBeenCalledTimes(2);
    expect(mockDeleteWorkspace.mock.calls[0]![0]).toBe("stopped-1");
    expect(mockDeleteWorkspace.mock.calls[1]![0]).toBe("stopped-2");
    expect(mockCloseWorkspace).toHaveBeenCalledTimes(1);
    expect(mockCloseWorkspace.mock.calls[0]![0]).toBe("cmux-1");
    expect(mockRemoveLayout).toHaveBeenCalledTimes(1);
    expect(mockRemoveLayout.mock.calls[0]![0]).toBe("layout-1");
  });

  it("skips running, starting, and failed workspaces", async () => {
    await runPrune({ yes: true });

    const deletedNames = mockDeleteWorkspace.mock.calls.map((c) => c[0]);
    expect(deletedNames).not.toContain("running-1");
    expect(deletedNames).not.toContain("starting-1");
    expect(deletedNames).not.toContain("failed-1");
  });

  it("exits cleanly when no stopped workspaces exist", async () => {
    mockLoadWorkspaces.mockImplementation(() => ({
      cached: null,
      fresh: Promise.resolve([runningWs, startingWs]),
    }));

    await runPrune({ yes: true });

    expect(mockDeleteWorkspace).not.toHaveBeenCalled();
  });

  it("continues past individual deletion failures", async () => {
    mockDeleteWorkspace.mockImplementation((name: string) => {
      if (name === "stopped-1") return Promise.reject(new Error("boom"));
      return Promise.resolve();
    });

    await runPrune({ yes: true });

    expect(mockDeleteWorkspace).toHaveBeenCalledTimes(2);
    expect(mockDeleteWorkspace.mock.calls[1]![0]).toBe("stopped-2");
  });

  it("--yes skips confirmation prompt", async () => {
    await runPrune({ yes: true });
    expect(mockConfirm).not.toHaveBeenCalled();
  });

  it("prompts for confirmation without --yes", async () => {
    await runPrune({ yes: false });
    expect(mockConfirm).toHaveBeenCalledTimes(1);
  });
});
