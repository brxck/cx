import { getPreferenceValues } from "@raycast/api";
import type {
  WorkspaceInfo,
  LayoutInfo,
  StatusResponse,
  TemplateInfo,
  TemplatesResponse,
  AppsResponse,
} from "@cx/api-types";

export type {
  WorkspaceInfo,
  LayoutInfo,
  StatusResponse,
  TemplateInfo,
  TemplatesResponse,
  AppsResponse,
};

interface Preferences {
  host?: string;
  port?: string;
}

export function baseUrl(): string {
  const prefs = getPreferenceValues<Preferences>();
  const host = prefs.host?.trim() || "localhost";
  const port = prefs.port?.trim() || "7373";
  return `http://${host}:${port}`;
}

export function apiUrl(path: string): string {
  return `${baseUrl()}${path}`;
}

export class CxServeUnreachable extends Error {
  constructor(cause: unknown) {
    super(`cx serve is not reachable. Run \`cx serve\` and try again.`);
    this.name = "CxServeUnreachable";
    this.cause = cause;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(apiUrl(path), init);
  } catch (err) {
    throw new CxServeUnreachable(err);
  }
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) detail = body.error;
    } catch {
      // non-JSON body — keep status-line detail
    }
    throw new Error(detail);
  }
  return (await res.json()) as T;
}

export function getStatus(): Promise<StatusResponse> {
  return request<StatusResponse>("/api/status");
}

export function getTemplates(): Promise<TemplatesResponse> {
  return request<TemplatesResponse>("/api/templates");
}

export function getApps(workspace: string): Promise<AppsResponse> {
  const params = new URLSearchParams({ workspace });
  return request<AppsResponse>(`/api/apps?${params.toString()}`);
}

export function activateLayout(layout: string) {
  return request<{ ok: boolean; layout: string }>("/api/activate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ layout }),
  });
}

export function downLayout(layout: string, stop = false) {
  return request<{ ok: boolean }>("/api/down", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ layout, stop }),
  });
}

export function startWorkspace(workspace: string) {
  return request<{ ok: boolean }>("/api/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspace }),
  });
}

export function stopWorkspace(workspace: string) {
  return request<{ ok: boolean }>("/api/stop", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspace }),
  });
}

/**
 * Up streams Server-Sent Events. Drains the body and resolves once the stream
 * ends or a `done` / `error` event arrives.
 */
export async function upWorkspace(args: {
  template: string;
  workspace: string;
  vars?: Record<string, string>;
}): Promise<{ ok: boolean; error?: string }> {
  let res: Response;
  try {
    res = await fetch(apiUrl("/api/up"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(args),
    });
  } catch (err) {
    throw new CxServeUnreachable(err);
  }

  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) detail = body.error;
    } catch {
      // non-JSON body
    }
    return { ok: false, error: detail };
  }

  const reader = res.body?.getReader();
  if (!reader) return { ok: true };

  const decoder = new TextDecoder();
  let buf = "";
  let lastError: string | undefined;
  let sawDone = false;

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nlIdx;
    while ((nlIdx = buf.indexOf("\n\n")) !== -1) {
      const event = buf.slice(0, nlIdx).trim();
      buf = buf.slice(nlIdx + 2);
      if (!event.startsWith("data:")) continue;
      const json = event.slice(event.indexOf(":") + 1).trim();
      try {
        const parsed = JSON.parse(json) as { stage: string; message?: string };
        if (parsed.stage === "error")
          lastError = parsed.message ?? "Unknown error";
        if (parsed.stage === "done") sawDone = true;
      } catch {
        // ignore malformed line
      }
    }
  }

  if (lastError) return { ok: false, error: lastError };
  return { ok: sawDone };
}

// Streaming endpoints (restart, update) — drain like `upWorkspace` but generic.
export async function streamAction(
  path: string,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; error?: string }> {
  let res: Response;
  try {
    res = await fetch(apiUrl(path), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new CxServeUnreachable(err);
  }
  if (!res.ok) return { ok: false, error: `${res.status} ${res.statusText}` };
  const reader = res.body?.getReader();
  if (!reader) return { ok: true };
  const decoder = new TextDecoder();
  let buf = "";
  let lastError: string | undefined;
  let sawDone = false;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nlIdx;
    while ((nlIdx = buf.indexOf("\n\n")) !== -1) {
      const chunk = buf.slice(0, nlIdx).trim();
      buf = buf.slice(nlIdx + 2);
      if (!chunk.startsWith("data:")) continue;
      const json = chunk.slice(chunk.indexOf(":") + 1).trim();
      try {
        const parsed = JSON.parse(json) as { stage: string; message?: string };
        if (parsed.stage === "error")
          lastError = parsed.message ?? "Unknown error";
        if (parsed.stage === "done") sawDone = true;
      } catch {
        // ignore
      }
    }
  }
  if (lastError) return { ok: false, error: lastError };
  return { ok: sawDone };
}

export const restartWorkspace = (workspace: string) =>
  streamAction("/api/restart", { workspace });
export const updateWorkspace = (workspace: string) =>
  streamAction("/api/update", { workspace });
