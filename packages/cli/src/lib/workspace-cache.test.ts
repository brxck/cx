import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { _resetDb, saveLayout, getLayout } from "./store.ts";
import type { CoderWorkspace } from "./coder.ts";

let mockListWorkspaces = mock(async (): Promise<CoderWorkspace[]> => []);

mock.module("./coder.ts", () => ({
  listWorkspaces: (...args: unknown[]) => mockListWorkspaces(...(args as [])),
}));

import {
  getCachedWorkspaces,
  setCachedWorkspaces,
  upsertCachedWorkspace,
  removeCachedWorkspace,
  clearCachedWorkspaces,
  loadWorkspaces,
} from "./workspace-cache.ts";

function makeWorkspace(name: string, overrides: Partial<CoderWorkspace> = {}): CoderWorkspace {
  return {
    id: `id-${name}`,
    name,
    owner_name: "owner",
    organization_name: "org",
    template_name: "tmpl",
    outdated: false,
    latest_build: {
      status: "running",
      transition: "start",
      created_at: new Date().toISOString(),
      template_version_name: "v1",
      resources: [],
    },
    health: { healthy: true, failing_agents: [] },
    ...overrides,
  } as CoderWorkspace;
}

beforeEach(() => {
  _resetDb(":memory:");
  mockListWorkspaces = mock(async () => []);
});

afterEach(() => _resetDb());

describe("workspace cache round-trip", () => {
  it("setCachedWorkspaces / getCachedWorkspaces", () => {
    const before = Date.now();
    const w1 = makeWorkspace("alpha");
    const w2 = makeWorkspace("beta");
    setCachedWorkspaces([w1, w2]);

    const cached = getCachedWorkspaces();
    expect(cached.workspaces).toHaveLength(2);
    expect(cached.workspaces.map((w) => w.name).sort()).toEqual(["alpha", "beta"]);
    expect(cached.cachedAt).not.toBeNull();
    expect(cached.cachedAt!).toBeGreaterThanOrEqual(before);
  });

  it("returns empty + null cachedAt before any write", () => {
    const cached = getCachedWorkspaces();
    expect(cached.workspaces).toEqual([]);
    expect(cached.cachedAt).toBeNull();
  });

  it("upsertCachedWorkspace updates one row only", () => {
    setCachedWorkspaces([makeWorkspace("a"), makeWorkspace("b")]);
    upsertCachedWorkspace(makeWorkspace("a", { outdated: true }));
    const cached = getCachedWorkspaces();
    const a = cached.workspaces.find((w) => w.name === "a")!;
    const b = cached.workspaces.find((w) => w.name === "b")!;
    expect(a.outdated).toBe(true);
    expect(b.outdated).toBe(false);
  });

  it("removeCachedWorkspace removes only that row", () => {
    setCachedWorkspaces([makeWorkspace("a"), makeWorkspace("b")]);
    removeCachedWorkspace("a");
    const cached = getCachedWorkspaces();
    expect(cached.workspaces.map((w) => w.name)).toEqual(["b"]);
  });

  it("clearCachedWorkspaces empties everything", () => {
    setCachedWorkspaces([makeWorkspace("a")]);
    clearCachedWorkspaces();
    expect(getCachedWorkspaces()).toEqual({ workspaces: [], cachedAt: null });
  });

  it("setCachedWorkspaces is transactional — rollback preserves existing rows", () => {
    setCachedWorkspaces([makeWorkspace("a")]);
    const dup = [makeWorkspace("dup"), makeWorkspace("dup")];
    expect(() => setCachedWorkspaces(dup)).toThrow();
    const cached = getCachedWorkspaces();
    expect(cached.workspaces.map((w) => w.name)).toEqual(["a"]);
  });
});

describe("loadWorkspaces SWR", () => {
  it("returns cached: null on first run with empty cache", async () => {
    mockListWorkspaces.mockImplementationOnce(async () => [makeWorkspace("a")]);
    const { cached, fresh } = loadWorkspaces();
    expect(cached).toBeNull();
    const list = await fresh;
    expect(list.map((w) => w.name)).toEqual(["a"]);
  });

  it("returns cached when present and refreshes in background", async () => {
    setCachedWorkspaces([makeWorkspace("cached-a")]);
    mockListWorkspaces.mockImplementationOnce(async () => [makeWorkspace("fresh-a")]);
    const { cached, fresh } = loadWorkspaces();
    expect(cached).not.toBeNull();
    expect(cached!.workspaces.map((w) => w.name)).toEqual(["cached-a"]);
    const list = await fresh;
    expect(list.map((w) => w.name)).toEqual(["fresh-a"]);
    // After refresh, cache reflects fresh data
    const after = getCachedWorkspaces();
    expect(after.workspaces.map((w) => w.name)).toEqual(["fresh-a"]);
  });

  it("dedupes concurrent in-process callers", () => {
    let resolveFn: ((list: CoderWorkspace[]) => void) | null = null;
    mockListWorkspaces.mockImplementationOnce(
      () =>
        new Promise<CoderWorkspace[]>((resolve) => {
          resolveFn = resolve;
        }),
    );
    const a = loadWorkspaces();
    const b = loadWorkspaces();
    expect(a.fresh).toBe(b.fresh);
    resolveFn!([makeWorkspace("a")]);
  });
});

describe("auto-prune on refresh", () => {
  it("removes stale layouts after loadWorkspaces resolves", async () => {
    saveLayout({ name: "stale-layout", cmux_id: "ws:1", coder_ws: "stale-ws" });
    saveLayout({ name: "fresh-layout", cmux_id: "ws:2", coder_ws: "fresh-ws" });
    mockListWorkspaces.mockImplementationOnce(async () => [makeWorkspace("fresh-ws")]);
    const { fresh } = loadWorkspaces();
    await fresh;
    expect(getLayout("stale-layout")).toBeNull();
    expect(getLayout("fresh-layout")).not.toBeNull();
  });
});
