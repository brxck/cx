import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync, readdirSync, unlinkSync, existsSync } from "node:fs";

// ── Types ──

export interface TemplateVariable {
  default?: string;
  description?: string;
}

export interface TemplateConfig {
  name: string;
  coder: {
    template: string;
    parameters?: Record<string, string>;
    preset?: string;
  };
  type: "ephemeral" | "persistent";
  color?: string;
  ports?: string[];
  variables?: Record<string, TemplateVariable>;
  layout: LayoutNode;
}

export type LayoutNode = SplitNode | PaneNode;

export interface SplitNode {
  direction: "horizontal" | "vertical";
  split?: number;
  children: [LayoutNode, LayoutNode];
}

export interface PaneNode {
  pane: {
    surfaces: SurfaceConfig[];
  };
}

export interface SurfaceConfig {
  type: "terminal" | "browser";
  session?: string;
  command?: string | string[];
  url?: string;
  focus?: boolean;
}

export function isSplitNode(node: LayoutNode): node is SplitNode {
  return "direction" in node;
}

export function isPaneNode(node: LayoutNode): node is PaneNode {
  return "pane" in node;
}

/** Normalize a command field (string or string[]) into a single shell string. */
export function normalizeCommand(cmd: string | string[] | undefined): string | undefined {
  if (cmd == null) return undefined;
  if (Array.isArray(cmd)) return cmd.join(" && ");
  return cmd;
}

// ── Template management ──

const TEMPLATES_DIR = join(homedir(), ".config", "cx", "templates");

function ensureTemplatesDir(): void {
  mkdirSync(TEMPLATES_DIR, { recursive: true });
}

/** List all saved templates. */
export function listTemplates(): TemplateConfig[] {
  ensureTemplatesDir();
  return readdirSync(TEMPLATES_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      const content = Bun.file(join(TEMPLATES_DIR, f)).json();
      return content;
    }) as unknown as TemplateConfig[];
}

/** List all saved templates (async for Bun.file). */
export async function listTemplatesAsync(): Promise<TemplateConfig[]> {
  ensureTemplatesDir();
  const files = readdirSync(TEMPLATES_DIR).filter((f) => f.endsWith(".json"));
  return Promise.all(
    files.map((f) => Bun.file(join(TEMPLATES_DIR, f)).json() as Promise<TemplateConfig>),
  );
}

/** Get a template by name. */
export async function getTemplate(name: string): Promise<TemplateConfig | null> {
  const path = join(TEMPLATES_DIR, `${name}.json`);
  if (!existsSync(path)) return null;
  return Bun.file(path).json() as Promise<TemplateConfig>;
}

/** Save a template. */
export async function saveTemplate(template: TemplateConfig): Promise<void> {
  ensureTemplatesDir();
  await Bun.write(
    join(TEMPLATES_DIR, `${template.name}.json`),
    JSON.stringify(template, null, 2) + "\n",
  );
}

/** Load project-local templates from cx.json. */
export async function getProjectTemplates(dir?: string): Promise<{ templates: TemplateConfig[]; projectPath: string } | null> {
  const startDir = dir ?? process.cwd();

  // Check the given directory first
  const localPath = join(startDir, "cx.json");
  if (existsSync(localPath)) {
    const data = await Bun.file(localPath).json() as { templates: TemplateConfig[] };
    return { templates: data.templates, projectPath: startDir };
  }

  // Fall back to git root
  try {
    const result = Bun.spawnSync(["git", "-C", startDir, "rev-parse", "--show-toplevel"]);
    const gitRoot = result.stdout.toString().trim();
    if (gitRoot && gitRoot !== startDir) {
      const rootPath = join(gitRoot, "cx.json");
      if (existsSync(rootPath)) {
        const data = await Bun.file(rootPath).json() as { templates: TemplateConfig[] };
        return { templates: data.templates, projectPath: gitRoot };
      }
    }
  } catch {}

  return null;
}

/** Resolve a template from project-local config, global name, or interactive picker. */
export async function resolveTemplate(opts?: {
  name?: string;
  cwd?: string;
}): Promise<{ template: TemplateConfig; projectPath: string | null } | null> {
  const project = await getProjectTemplates(opts?.cwd);
  const projectTemplates = project?.templates ?? [];
  const projectPath = project?.projectPath ?? null;

  // If name provided, check project-local first, then global
  if (opts?.name) {
    const local = projectTemplates.find((t) => t.name === opts.name);
    if (local) return { template: local, projectPath };
    const global = await getTemplate(opts.name);
    if (global) return { template: global, projectPath: null };
    return null;
  }

  // Merge project-local + global for the picker
  const globalTemplates = await listTemplatesAsync();

  type PickerEntry = { template: TemplateConfig; isProject: boolean };
  const entries: PickerEntry[] = [
    ...projectTemplates.map((t) => ({ template: t, isProject: true })),
    ...globalTemplates.map((t) => ({ template: t, isProject: false })),
  ];

  if (entries.length === 0) return null;

  const pc = (await import("picocolors")).default;
  const p = await import("@clack/prompts");

  const choice = await p.select({
    message: "Select a template",
    options: entries.map((e) => ({
      value: e,
      label: `${pc.bold(e.template.name)}  ${pc.dim(e.template.coder.template)}  ${pc.dim(e.template.type)}${e.isProject ? `  ${pc.dim("(project)")}` : ""}`,
    })),
  });

  if (p.isCancel(choice)) {
    p.cancel("Cancelled.");
    process.exit(0);
  }

  const picked = choice as PickerEntry;
  return {
    template: picked.template,
    projectPath: picked.isProject ? projectPath : null,
  };
}

/** Delete a template by name. Returns true if it existed. */
export function deleteTemplate(name: string): boolean {
  const path = join(TEMPLATES_DIR, `${name}.json`);
  if (!existsSync(path)) return false;
  unlinkSync(path);
  return true;
}

