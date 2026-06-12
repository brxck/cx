export interface WorkspaceApp {
  slug: string;
  label: string;
  url: string;
  icon?: string;
}

export interface TaskInfo {
  id: string;
  displayName: string;
  status: string;
  state?: string;
  message?: string;
  /** Coder task state URI. This can point to any external resource. */
  uri?: string;
  /** @deprecated Use uri. */
  prUrl?: string;
  /** Coder Task UI URL, e.g. `${baseUrl}/tasks/${owner}/${taskId}`. */
  url?: string;
}

/**
 * Latest agent app status reported by a workspace, mirroring Coder's
 * `latest_app_status`. Present whether or not the workspace backs a task.
 */
export interface AppStatus {
  state?: string;
  message?: string;
  /** External resource the agent produced (typically a PR URL). */
  uri?: string;
}

export interface WorkspaceInfo {
  name: string;
  status: string;
  healthy: boolean;
  outdated: boolean;
  buildAge: string;
  lastBuildAt: string;
  templateName: string;
  sessions: string[];
  dashboard?: string;
  terminal?: string;
  apps?: WorkspaceApp[];
  task?: TaskInfo;
  appStatus?: AppStatus;
}

export interface LayoutInfo {
  name: string;
  cmuxId: string;
  coderWs: string;
  template: string | null;
  type: "task" | "persistent";
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

export type TemplateInputKind = "text" | "multiline" | "number" | "confirm" | "select" | "multiselect";

export interface TemplateInputOption {
  value: string;
  label: string;
}

/** A single input a template declares, used to render a create form. */
export interface TemplateInputField {
  name: string;
  kind: TemplateInputKind;
  description?: string;
  placeholder?: string;
  default?: string | number | boolean | string[];
  /** Present for select / multiselect. */
  options?: TemplateInputOption[];
}

export interface TemplateInputsResponse {
  fields: TemplateInputField[];
}

export interface AppsResponse {
  dashboard: string;
  terminal: string;
  /** Coder Task UI URL when this workspace backs a task; replaces the dashboard destination. */
  taskUrl?: string;
  apps: { slug: string; label: string; icon?: string }[];
}
