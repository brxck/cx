export interface WorkspaceApp {
  slug: string;
  label: string;
  url: string;
}

export interface WorkspaceInfo {
  name: string;
  status: string;
  healthy: boolean;
  outdated: boolean;
  buildAge: string;
  templateName: string;
  sessions: string[];
  dashboard?: string;
  terminal?: string;
  apps?: WorkspaceApp[];
}

export interface LayoutInfo {
  name: string;
  cmuxId: string;
  coderWs: string;
  template: string | null;
  type: "ephemeral" | "persistent";
  branch: string | null;
  path: string | null;
  activeAt: string;
  sessions: string[];
}

export interface StatusResponse {
  workspaces: WorkspaceInfo[];
  layouts: LayoutInfo[];
}

export interface TemplateInfo {
  name: string;
  kind: "json" | "js";
  type: string | null;
  coderTemplate: string | null;
  color: string | null;
  dynamic: boolean;
  source: "project" | "global";
  variables?: Record<string, unknown> | null;
}

export interface TemplatesResponse {
  templates: TemplateInfo[];
}

export interface AppsResponse {
  dashboard: string;
  terminal: string;
  apps: { slug: string; label: string }[];
}
