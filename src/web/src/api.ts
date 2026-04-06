const BASE = "";

export interface WorkspaceInfo {
  name: string;
  status: string;
  healthy: boolean;
  outdated: boolean;
  buildAge: string;
  templateName: string;
  sessions: string[];
}

export interface TemplateEntry {
  name: string;
  coder: { template: string };
  type: "ephemeral" | "persistent";
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

export async function fetchStatus(): Promise<StatusResponse> {
  const res = await fetch(`${BASE}/api/status`);
  if (!res.ok) throw new Error("Failed to fetch status");
  return res.json() as Promise<StatusResponse>;
}

export async function fetchTemplates(): Promise<TemplatesResponse> {
  const res = await fetch(`${BASE}/api/templates`);
  if (!res.ok) throw new Error("Failed to fetch templates");
  return res.json() as Promise<TemplatesResponse>;
}

export async function* streamUp(
  template: string,
  workspace: string,
): AsyncGenerator<UpEvent> {
  const res = await fetch(`${BASE}/api/up`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ template, workspace }),
  });

  if (!res.ok || !res.body) {
    throw new Error("Failed to start workspace creation");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
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

export interface AppEntry {
  slug: string;
  label: string;
}

export interface AppsResponse {
  dashboard: string;
  terminal: string;
  apps: AppEntry[];
}

export async function fetchApps(workspace: string): Promise<AppsResponse> {
  const res = await fetch(`${BASE}/api/apps?workspace=${encodeURIComponent(workspace)}`);
  if (!res.ok) throw new Error("Failed to fetch apps");
  return res.json() as Promise<AppsResponse>;
}

export async function startWorkspace(workspace: string): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`${BASE}/api/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspace }),
  });
  return res.json() as Promise<{ ok: boolean; error?: string }>;
}

export async function stopWorkspace(workspace: string): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`${BASE}/api/stop`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspace }),
  });
  return res.json() as Promise<{ ok: boolean; error?: string }>;
}

export async function* streamUpdate(workspace: string): AsyncGenerator<UpEvent> {
  const res = await fetch(`${BASE}/api/update`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspace }),
  });

  if (!res.ok || !res.body) {
    throw new Error("Failed to start workspace update");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
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

export async function* streamRestart(workspace: string): AsyncGenerator<UpEvent> {
  const res = await fetch(`${BASE}/api/restart`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspace }),
  });

  if (!res.ok || !res.body) {
    throw new Error("Failed to start workspace restart");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
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

export async function tearDown(layout: string, stop: boolean): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`${BASE}/api/down`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ layout, stop }),
  });
  return res.json() as Promise<{ ok: boolean; error?: string }>;
}
