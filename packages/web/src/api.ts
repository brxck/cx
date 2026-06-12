const BASE = "";

function readKey(): string {
  if (typeof document === "undefined") return "";
  const meta = document.querySelector('meta[name="cx-key"]') as HTMLMetaElement | null;
  return meta?.content?.trim() ?? "";
}

function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const key = readKey();
  const headers: Record<string, string> = { ...extra };
  if (key) headers["Authorization"] = `Bearer ${key}`;
  return headers;
}

async function cxFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    ...init,
    headers: authHeaders(init?.headers as Record<string, string> | undefined),
  });
}

export interface TaskInfo {
  id: string;
  displayName: string;
  status: string;
  state?: string;
  message?: string;
  uri?: string;
  /** @deprecated Use uri. */
  prUrl?: string;
  url?: string;
}

export interface AgentInfo {
  name: string;
  status: string;
  lifecycleState: string;
  healthReason?: string;
  arch?: string;
  os?: string;
  version?: string;
  latencyMs?: number;
  startupDurationMs?: number;
}

export interface ResourceMeta {
  key: string;
  value: string;
}

export interface WorkspaceInfo {
  name: string;
  status: string;
  healthy: boolean;
  outdated: boolean;
  favorite?: boolean;
  buildAge: string;
  lastBuildAt: string;
  lastUsedAt?: string;
  templateName: string;
  templateDisplayName?: string;
  templateIcon?: string;
  sessions: string[];
  task?: TaskInfo;
  appStatus?: { state?: string; message?: string; uri?: string; needsUserAttention?: boolean };
  buildReason?: string;
  dailyCost?: number;
  autoStopAt?: string;
  autostartSchedule?: string;
  automaticUpdates?: string;
  dormantAt?: string;
  deletingAt?: string;
  agent?: AgentInfo;
  resourceMeta?: ResourceMeta[];
  queuePosition?: number;
  buildError?: string;
}

export interface TemplateEntry {
  name: string;
  coder: { template: string };
  type: "task" | "persistent";
  source: "project" | "global";
}

export interface StatusResponse {
  workspaces: WorkspaceInfo[];
}

export interface TemplatesResponse {
  templates: TemplateEntry[];
}

export interface UpEvent {
  stage: string;
  message: string;
  layout?: string;
  sessions?: number;
}

export type TemplateInputKind = "text" | "multiline" | "number" | "confirm" | "select" | "multiselect";

export interface TemplateInputOption {
  value: string;
  label: string;
}

export interface TemplateInputField {
  name: string;
  kind: TemplateInputKind;
  description?: string;
  placeholder?: string;
  default?: string | number | boolean | string[];
  options?: TemplateInputOption[];
}

export interface TemplateInputsResponse {
  fields: TemplateInputField[];
}

export async function fetchStatus(): Promise<StatusResponse> {
  const res = await cxFetch("/api/status");
  if (!res.ok) throw new Error("Failed to fetch status");
  return res.json() as Promise<StatusResponse>;
}

export async function fetchTemplates(): Promise<TemplatesResponse> {
  const res = await cxFetch("/api/templates");
  if (!res.ok) throw new Error("Failed to fetch templates");
  return res.json() as Promise<TemplatesResponse>;
}

export async function fetchTemplateInputs(template: string): Promise<TemplateInputsResponse> {
  const res = await cxFetch(`/api/template-inputs?template=${encodeURIComponent(template)}`);
  if (!res.ok) throw new Error("Failed to fetch template inputs");
  return res.json() as Promise<TemplateInputsResponse>;
}

async function* streamSse(path: string, body: unknown): AsyncGenerator<UpEvent> {
  const res = await cxFetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok || !res.body) {
    throw new Error(`Failed to stream ${path}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop()!;

    for (const line of lines) {
      if (line.startsWith("data: ")) {
        yield JSON.parse(line.slice(6));
      }
    }
  }
}

export function streamUp(
  template: string,
  workspace: string,
  vars?: Record<string, string>,
): AsyncGenerator<UpEvent> {
  return streamSse("/api/up", { template, workspace, vars });
}

export function streamUpdate(workspace: string): AsyncGenerator<UpEvent> {
  return streamSse("/api/update", { workspace });
}

export function streamRestart(workspace: string): AsyncGenerator<UpEvent> {
  return streamSse("/api/restart", { workspace });
}

export interface AppEntry {
  slug: string;
  label: string;
  icon?: string;
}

export interface AppsResponse {
  dashboard: string;
  terminal: string;
  taskUrl?: string;
  apps: AppEntry[];
}

export async function fetchApps(workspace: string): Promise<AppsResponse> {
  const res = await cxFetch(`/api/apps?workspace=${encodeURIComponent(workspace)}`);
  if (!res.ok) throw new Error("Failed to fetch apps");
  return res.json() as Promise<AppsResponse>;
}

export async function startWorkspace(workspace: string): Promise<{ ok: boolean; error?: string }> {
  const res = await cxFetch("/api/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspace }),
  });
  return res.json() as Promise<{ ok: boolean; error?: string }>;
}

export async function stopWorkspace(workspace: string): Promise<{ ok: boolean; error?: string }> {
  const res = await cxFetch("/api/stop", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspace }),
  });
  return res.json() as Promise<{ ok: boolean; error?: string }>;
}

export async function favoriteWorkspace(
  workspace: string,
  favorite: boolean,
): Promise<{ ok: boolean; error?: string }> {
  const res = await cxFetch("/api/favorite", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspace, favorite }),
  });
  return res.json() as Promise<{ ok: boolean; error?: string }>;
}

export async function tearDown(layout: string, stop: boolean): Promise<{ ok: boolean; error?: string }> {
  const res = await cxFetch("/api/down", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ layout, stop }),
  });
  return res.json() as Promise<{ ok: boolean; error?: string }>;
}
