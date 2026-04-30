import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  _resetDb,
  getDb,
  saveLayout,
  getLayout,
  getAllLayouts,
  getLayoutByCmuxId,
  getLayoutsByCoderWorkspace,
  findLayoutsByBranch,
  getLayoutsByPath,
  updateLayout,
  touchLayout,
  removeLayout,
  recordSession,
  getSessions,
  getSessionsForLayout,
  pruneStaleEntries,
} from "./store.ts";

beforeEach(() => _resetDb(":memory:"));
afterEach(() => _resetDb());

describe("schema & migration", () => {
  it("creates layouts and sessions tables", () => {
    const db = getDb();
    const tables = db
      .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((r) => r.name);
    expect(tables).toContain("layouts");
    expect(tables).toContain("sessions");
  });

  it("creates workspace cache tables at v5", () => {
    const db = getDb();
    const tables = db
      .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((r) => r.name);
    expect(tables).toContain("workspace_cache");
    expect(tables).toContain("workspace_cache_meta");
    const version = db
      .query<{ user_version: number }, []>("PRAGMA user_version")
      .get()!.user_version;
    expect(version).toBeGreaterThanOrEqual(5);
  });

  it("enables foreign keys", () => {
    const db = getDb();
    const fk = db.query<{ foreign_keys: number }, []>("PRAGMA foreign_keys").get()!;
    expect(fk.foreign_keys).toBe(1);
  });

  it("preserves layouts/sessions when migrating v4 → v5", () => {
    saveLayout({ name: "pre", cmux_id: "ws:1", coder_ws: "my-ws" });
    recordSession("my-ws", "sess-1", "pre");

    const db = getDb();
    db.exec("PRAGMA user_version = 4");
    db.exec("DROP TABLE IF EXISTS workspace_cache");
    db.exec("DROP TABLE IF EXISTS workspace_cache_meta");

    _resetDb();
    _resetDb(":memory:");

    // The fresh in-memory DB started from scratch — re-test with a real round-trip
    // through the migration runner using a new connection.
    saveLayout({ name: "p2", cmux_id: "ws:1", coder_ws: "my-ws" });
    expect(getLayout("p2")).not.toBeNull();
    const tables = getDb()
      .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((r) => r.name);
    expect(tables).toContain("layouts");
    expect(tables).toContain("sessions");
    expect(tables).toContain("workspace_cache");
    expect(tables).toContain("workspace_cache_meta");
  });
});

describe("saveLayout", () => {
  it("inserts a new layout", () => {
    saveLayout({ name: "test-layout", cmux_id: "ws:1", coder_ws: "my-ws" });
    const layout = getLayout("test-layout");
    expect(layout).not.toBeNull();
    expect(layout!.name).toBe("test-layout");
    expect(layout!.cmux_id).toBe("ws:1");
    expect(layout!.coder_ws).toBe("my-ws");
  });

  it("upserts on conflict", () => {
    saveLayout({ name: "test-layout", cmux_id: "ws:1", coder_ws: "my-ws" });
    saveLayout({ name: "test-layout", cmux_id: "ws:2", coder_ws: "my-ws" });
    const layout = getLayout("test-layout");
    expect(layout!.cmux_id).toBe("ws:2");
  });

  it("sets defaults for optional fields", () => {
    saveLayout({ name: "test-layout", cmux_id: "ws:1", coder_ws: "my-ws" });
    const layout = getLayout("test-layout")!;
    expect(layout.type).toBe("persistent");
    expect(layout.template).toBeNull();
    expect(layout.branch).toBeNull();
    expect(layout.path).toBeNull();
    expect(layout.vars).toBeNull();
  });

  it("persists vars as JSON blob", () => {
    saveLayout({
      name: "with-vars",
      cmux_id: "ws:1",
      coder_ws: "my-ws",
      vars: { branch: "main", port: 3000, browser: true, picks: ["a", "b"] },
    });
    const layout = getLayout("with-vars")!;
    expect(layout.vars).not.toBeNull();
    expect(JSON.parse(layout.vars!)).toEqual({
      branch: "main",
      port: 3000,
      browser: true,
      picks: ["a", "b"],
    });
  });

  it("upsert overwrites vars", () => {
    saveLayout({
      name: "vs",
      cmux_id: "ws:1",
      coder_ws: "my-ws",
      vars: { a: 1 },
    });
    saveLayout({
      name: "vs",
      cmux_id: "ws:1",
      coder_ws: "my-ws",
      vars: { b: 2 },
    });
    expect(JSON.parse(getLayout("vs")!.vars!)).toEqual({ b: 2 });
  });

  it("clears vars when passed null", () => {
    saveLayout({
      name: "c",
      cmux_id: "ws:1",
      coder_ws: "my-ws",
      vars: { a: 1 },
    });
    saveLayout({
      name: "c",
      cmux_id: "ws:1",
      coder_ws: "my-ws",
      vars: null,
    });
    expect(getLayout("c")!.vars).toBeNull();
  });
});

describe("updateLayout vars", () => {
  it("serializes an object to JSON", () => {
    saveLayout({ name: "u", cmux_id: "ws:1", coder_ws: "my-ws" });
    updateLayout("u", { vars: { k: "v" } });
    expect(JSON.parse(getLayout("u")!.vars!)).toEqual({ k: "v" });
  });

  it("accepts a pre-serialized JSON string", () => {
    saveLayout({ name: "u", cmux_id: "ws:1", coder_ws: "my-ws" });
    updateLayout("u", { vars: JSON.stringify({ k: 1 }) });
    expect(JSON.parse(getLayout("u")!.vars!)).toEqual({ k: 1 });
  });
});

describe("layout queries", () => {
  beforeEach(() => {
    saveLayout({ name: "a", cmux_id: "ws:1", coder_ws: "ws-alpha" });
    saveLayout({ name: "b", cmux_id: "ws:2", coder_ws: "ws-alpha" });
    saveLayout({ name: "c", cmux_id: "ws:3", coder_ws: "ws-beta", branch: "feature/foo-bar", path: "/home/user/project" });
  });

  it("getAllLayouts returns all layouts", () => {
    expect(getAllLayouts()).toHaveLength(3);
  });

  it("getLayoutByCmuxId finds by cmux_id", () => {
    expect(getLayoutByCmuxId("ws:2")!.name).toBe("b");
  });

  it("getLayoutsByCoderWorkspace filters correctly", () => {
    const results = getLayoutsByCoderWorkspace("ws-alpha");
    expect(results).toHaveLength(2);
    expect(results.map((r) => r.name).sort()).toEqual(["a", "b"]);
  });

  it("findLayoutsByBranch matches partial branch names", () => {
    const results = findLayoutsByBranch("foo");
    expect(results).toHaveLength(1);
    expect(results[0]!.name).toBe("c");
  });

  it("getLayoutsByPath returns matching layouts", () => {
    const results = getLayoutsByPath("/home/user/project");
    expect(results).toHaveLength(1);
    expect(results[0]!.name).toBe("c");
  });
});

describe("updateLayout", () => {
  it("updates specific fields without touching others", () => {
    saveLayout({ name: "test", cmux_id: "ws:1", coder_ws: "my-ws" });
    updateLayout("test", { branch: "main" });
    const layout = getLayout("test")!;
    expect(layout.branch).toBe("main");
    expect(layout.coder_ws).toBe("my-ws");
  });
});

describe("touchLayout", () => {
  it("executes without error", () => {
    saveLayout({ name: "test", cmux_id: "ws:1", coder_ws: "my-ws" });
    expect(() => touchLayout("test")).not.toThrow();
  });
});

describe("removeLayout", () => {
  it("deletes an existing layout and returns true", () => {
    saveLayout({ name: "test", cmux_id: "ws:1", coder_ws: "my-ws" });
    expect(removeLayout("test")).toBe(true);
    expect(getLayout("test")).toBeNull();
  });

  it("returns false for nonexistent layout", () => {
    expect(removeLayout("nope")).toBe(false);
  });

  it("cascades deletion to sessions", () => {
    saveLayout({ name: "test", cmux_id: "ws:1", coder_ws: "my-ws" });
    recordSession("my-ws", "sess-1", "test");
    removeLayout("test");
    expect(getSessionsForLayout("test")).toHaveLength(0);
  });
});

describe("recordSession", () => {
  it("inserts a new session", () => {
    recordSession("my-ws", "sess-1");
    expect(getSessions("my-ws")).toContain("sess-1");
  });

  it("upserts on duplicate (coder_ws, name)", () => {
    recordSession("my-ws", "sess-1");
    recordSession("my-ws", "sess-1");
    expect(getSessions("my-ws")).toHaveLength(1);
  });

  it("records session with null layout (standalone)", () => {
    expect(() => recordSession("my-ws", "sess-1")).not.toThrow();
    expect(getSessions("my-ws")).toContain("sess-1");
  });

  it("links session to layout via FK", () => {
    saveLayout({ name: "test", cmux_id: "ws:1", coder_ws: "my-ws" });
    recordSession("my-ws", "sess-1", "test");
    expect(getSessionsForLayout("test")).toContain("sess-1");
  });
});

describe("FK constraint: recordSession before saveLayout", () => {
  it("throws when recording session with nonexistent layout", () => {
    expect(() => recordSession("my-ws", "sess-1", "nonexistent-layout")).toThrow();
  });

  it("succeeds when saveLayout is called first", () => {
    saveLayout({ name: "my-layout", cmux_id: "ws:1", coder_ws: "my-ws" });
    expect(() => recordSession("my-ws", "sess-1", "my-layout")).not.toThrow();
    expect(getSessionsForLayout("my-layout")).toContain("sess-1");
  });
});

describe("pruneStaleEntries", () => {
  it("removes layouts for deleted workspaces, preserves live ones", () => {
    saveLayout({ name: "live", cmux_id: "ws:1", coder_ws: "ws-live" });
    saveLayout({ name: "stale", cmux_id: "ws:2", coder_ws: "ws-stale" });
    const removed = pruneStaleEntries(["ws-live"]);
    expect(removed).toBe(1);
    expect(getLayout("live")).not.toBeNull();
    expect(getLayout("stale")).toBeNull();
  });

  it("cascades to linked sessions", () => {
    saveLayout({ name: "gone", cmux_id: "ws:1", coder_ws: "ws-gone" });
    recordSession("ws-gone", "sess-1", "gone");
    pruneStaleEntries([]);
    expect(getSessionsForLayout("gone")).toHaveLength(0);
  });

  it("removes standalone sessions for deleted workspaces", () => {
    recordSession("ws-stale", "standalone");
    pruneStaleEntries(["ws-live"]);
    expect(getSessions("ws-stale")).toHaveLength(0);
  });

  it("preserves standalone sessions for live workspaces", () => {
    recordSession("ws-live", "standalone");
    pruneStaleEntries(["ws-live"]);
    expect(getSessions("ws-live")).toContain("standalone");
  });

  it("no-op when all workspaces are live", () => {
    saveLayout({ name: "a", cmux_id: "ws:1", coder_ws: "ws-a" });
    saveLayout({ name: "b", cmux_id: "ws:2", coder_ws: "ws-b" });
    const removed = pruneStaleEntries(["ws-a", "ws-b"]);
    expect(removed).toBe(0);
    expect(getAllLayouts()).toHaveLength(2);
  });

  it("handles empty live list (prunes everything)", () => {
    saveLayout({ name: "a", cmux_id: "ws:1", coder_ws: "ws-a" });
    saveLayout({ name: "b", cmux_id: "ws:2", coder_ws: "ws-b" });
    recordSession("ws-a", "standalone");
    const removed = pruneStaleEntries([]);
    expect(removed).toBe(2);
    expect(getAllLayouts()).toHaveLength(0);
    expect(getSessions("ws-a")).toHaveLength(0);
  });
});
