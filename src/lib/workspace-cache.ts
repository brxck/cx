import { listWorkspaces, type CoderWorkspace } from "./coder.ts";
import { getDb } from "./store.ts";

export interface CachedWorkspaces {
  workspaces: CoderWorkspace[];
  cachedAt: number | null;
}

export interface SwrLoad {
  cached: CachedWorkspaces | null;
  fresh: Promise<CoderWorkspace[]>;
}

interface CacheRow {
  json: string;
  cached_at: number;
}

interface MetaRow {
  cached_at: number;
}

export function getCachedWorkspaces(): CachedWorkspaces {
  const db = getDb();
  const meta = db
    .query<MetaRow, []>("SELECT cached_at FROM workspace_cache_meta WHERE id = 1")
    .get();
  const rows = db
    .query<CacheRow, []>("SELECT json, cached_at FROM workspace_cache")
    .all();
  const workspaces: CoderWorkspace[] = [];
  for (const row of rows) {
    try {
      workspaces.push(JSON.parse(row.json) as CoderWorkspace);
    } catch {
      // ignore malformed rows
    }
  }
  return { workspaces, cachedAt: meta?.cached_at ?? null };
}

export function setCachedWorkspaces(workspaces: CoderWorkspace[]): void {
  const db = getDb();
  const now = Date.now();
  const tx = db.transaction((list: CoderWorkspace[]) => {
    db.query("DELETE FROM workspace_cache").run();
    const insert = db.query(
      "INSERT INTO workspace_cache (name, json, cached_at) VALUES (?1, ?2, ?3)",
    );
    for (const ws of list) {
      insert.run(ws.name, JSON.stringify(ws), now);
    }
    db.query(
      `INSERT INTO workspace_cache_meta (id, cached_at) VALUES (1, ?1)
       ON CONFLICT(id) DO UPDATE SET cached_at = ?1`,
    ).run(now);
  });
  tx(workspaces);
}

export function upsertCachedWorkspace(ws: CoderWorkspace): void {
  const db = getDb();
  const now = Date.now();
  db.query(
    `INSERT INTO workspace_cache (name, json, cached_at) VALUES (?1, ?2, ?3)
     ON CONFLICT(name) DO UPDATE SET json = ?2, cached_at = ?3`,
  ).run(ws.name, JSON.stringify(ws), now);
}

export function removeCachedWorkspace(name: string): void {
  getDb().query("DELETE FROM workspace_cache WHERE name = ?").run(name);
}

export function clearCachedWorkspaces(): void {
  const db = getDb();
  db.query("DELETE FROM workspace_cache").run();
  db.query("DELETE FROM workspace_cache_meta").run();
}

let inflight: Promise<CoderWorkspace[]> | null = null;

function startRefresh(): Promise<CoderWorkspace[]> {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const list = await listWorkspaces();
      setCachedWorkspaces(list);
      return list;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export function loadWorkspaces(): SwrLoad {
  const cached = getCachedWorkspaces();
  const fresh = startRefresh();
  return {
    cached: cached.cachedAt === null ? null : cached,
    fresh,
  };
}

/**
 * Fire-and-forget cache refresh after a coder mutation. Awaits internally;
 * callers do NOT await.
 */
export function refreshCacheAsync(): void {
  void startRefresh().catch(() => {});
}
