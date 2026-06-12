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
  needsUserAttention?: boolean;
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
  scripts?: Array<{ displayName?: string; status?: string; exitCode?: number | null }>;
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
  dashboard?: string;
  terminal?: string;
  apps?: WorkspaceApp[];
  task?: TaskInfo;
  appStatus?: AppStatus;
  /** Why the latest build was triggered. */
  buildReason?: string;
  /** Daily cost units (if deployment uses quotas). */
  dailyCost?: number;
  /** ISO timestamp when the running workspace will auto-stop. */
  autoStopAt?: string;
  /** Cron schedule for auto-start (if set). */
  autostartSchedule?: string;
  /** Whether template updates are applied automatically. */
  automaticUpdates?: string;
  /** ISO timestamp if the workspace is dormant. */
  dormantAt?: string;
  /** ISO timestamp if the workspace is scheduled for deletion. */
  deletingAt?: string;
  /** Primary agent details (arch, OS, latency, etc.). */
  agent?: AgentInfo;
  /** Template-defined resource metadata (CPU, RAM, etc.). */
  resourceMeta?: ResourceMeta[];
  /** Build job queue position when pending. */
  queuePosition?: number;
  /** Build job error message (if failed). */
  buildError?: string;
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
