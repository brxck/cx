import { Database } from "bun:sqlite";
import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync } from "node:fs";

const CONFIG_DIR = join(homedir(), ".config", "cx");
const DB_PATH = join(CONFIG_DIR, "state.db");

let _db: Database | null = null;

const SCHEMA_V1 = `
CREATE TABLE IF NOT EXISTS layouts (
  name        TEXT PRIMARY KEY,
  cmux_id     TEXT NOT NULL,
  coder_ws    TEXT NOT NULL,
  template    TEXT,
  type        TEXT NOT NULL DEFAULT 'persistent',
  branch      TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  active_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  layout      TEXT REFERENCES layouts(name) ON DELETE CASCADE,
  coder_ws    TEXT NOT NULL,
  name        TEXT NOT NULL,
  last_used   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(coder_ws, name)
);

`;

function migrate(db: Database): void {
  const version = db.query<{ user_version: number }, []>("PRAGMA user_version").get()!.user_version;

  if (version < 1) {
    db.exec(SCHEMA_V1);
    db.exec("PRAGMA user_version = 1");
  }

  if (version < 2) {
    db.exec("ALTER TABLE layouts ADD COLUMN path TEXT");
    db.exec("PRAGMA user_version = 2");
  }
}

export function getDb(): Database {
  if (_db) return _db;
  mkdirSync(CONFIG_DIR, { recursive: true });
  _db = new Database(DB_PATH);
  _db.exec("PRAGMA journal_mode = WAL");
  _db.exec("PRAGMA foreign_keys = ON");
  migrate(_db);
  return _db;
}

// --- Types ---

export type LayoutType = "ephemeral" | "persistent";

export interface LayoutEntry {
  name: string;
  cmux_id: string;
  coder_ws: string;
  template: string | null;
  type: LayoutType;
  branch: string | null;
  path: string | null;
  created_at: string;
  active_at: string;
}

// --- Layouts ---

export function getAllLayouts(): LayoutEntry[] {
  return getDb().query<LayoutEntry, []>("SELECT * FROM layouts ORDER BY active_at DESC").all();
}

export function getLayout(name: string): LayoutEntry | null {
  return getDb().query<LayoutEntry, [string]>("SELECT * FROM layouts WHERE name = ?").get(name) ?? null;
}

export function getLayoutByCmuxId(cmuxId: string): LayoutEntry | null {
  return getDb().query<LayoutEntry, [string]>("SELECT * FROM layouts WHERE cmux_id = ?").get(cmuxId) ?? null;
}

export function getLayoutsByCoderWorkspace(coderWs: string): LayoutEntry[] {
  return getDb().query<LayoutEntry, [string]>("SELECT * FROM layouts WHERE coder_ws = ? ORDER BY active_at DESC").all(coderWs);
}

export function findLayoutsByBranch(branch: string): LayoutEntry[] {
  return getDb().query<LayoutEntry, [string]>("SELECT * FROM layouts WHERE branch LIKE '%' || ? || '%'").all(branch);
}

export function getLayoutsByPath(path: string): LayoutEntry[] {
  return getDb()
    .query<LayoutEntry, [string]>("SELECT * FROM layouts WHERE path = ? ORDER BY active_at DESC")
    .all(path);
}

export function saveLayout(entry: {
  name: string;
  cmux_id: string;
  coder_ws: string;
  template?: string | null;
  type?: LayoutType;
  branch?: string | null;
  path?: string | null;
}): void {
  getDb()
    .query(
      `INSERT INTO layouts (name, cmux_id, coder_ws, template, type, branch, path)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
       ON CONFLICT(name) DO UPDATE SET
         cmux_id = ?2, coder_ws = ?3, template = ?4, type = ?5, branch = ?6, path = ?7,
         active_at = datetime('now')`
    )
    .run(
      entry.name,
      entry.cmux_id,
      entry.coder_ws,
      entry.template ?? null,
      entry.type ?? "persistent",
      entry.branch ?? null,
      entry.path ?? null
    );
}

export function updateLayout(name: string, updates: Partial<Omit<LayoutEntry, "name">>): void {
  const fields: string[] = [];
  const values: (string | number | null)[] = [];

  for (const [key, value] of Object.entries(updates)) {
    if (key === "name") continue;
    fields.push(`${key} = ?`);
    values.push(value as string | number | null);
  }

  if (fields.length === 0) return;
  values.push(name);
  getDb().query(`UPDATE layouts SET ${fields.join(", ")} WHERE name = ?`).run(...values);
}

export function touchLayout(name: string): void {
  getDb().query("UPDATE layouts SET active_at = datetime('now') WHERE name = ?").run(name);
}

export function removeLayout(name: string): boolean {
  const result = getDb().query("DELETE FROM layouts WHERE name = ?").run(name);
  return result.changes > 0;
}

// --- Sessions ---

export function getSessions(coderWs: string): string[] {
  return getDb()
    .query<{ name: string }, [string]>("SELECT name FROM sessions WHERE coder_ws = ? ORDER BY last_used DESC")
    .all(coderWs)
    .map((r) => r.name);
}

export function getSessionsForLayout(layout: string): string[] {
  return getDb()
    .query<{ name: string }, [string]>("SELECT name FROM sessions WHERE layout = ? ORDER BY last_used DESC")
    .all(layout)
    .map((r) => r.name);
}

export function recordSession(coderWs: string, name: string, layout?: string): void {
  getDb()
    .query(
      `INSERT INTO sessions (coder_ws, name, layout)
       VALUES (?1, ?2, ?3)
       ON CONFLICT(coder_ws, name) DO UPDATE SET
         last_used = datetime('now'),
         layout = COALESCE(?3, layout)`
    )
    .run(coderWs, name, layout ?? null);
}

