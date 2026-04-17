import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync, readdirSync, unlinkSync, existsSync } from "node:fs";

// ── Types ──

export interface TemplateVariable {
  default?: string;
  description?: string;
}

export interface TemplateConfig {
  name: string; // optional in JSON files — defaults to filename
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
  cwd?: string;
  url?: string;
  focus?: boolean;
}

export function isSplitNode(node: unknown): node is SplitNode {
  return typeof node === "object" && node !== null && "direction" in node;
}

export function isPaneNode(node: unknown): node is PaneNode {
  return typeof node === "object" && node !== null && "pane" in node;
}

/** Recursively validate a layout tree; throws a descriptive error naming the offending path. */
export function validateLayout(node: unknown, path = "layout"): void {
  if (typeof node !== "object" || node === null) {
    throw new Error(`Invalid template layout at ${path}: expected pane or split node, got ${node === undefined ? "undefined" : typeof node}`);
  }
  if (isSplitNode(node)) {
    const split = node as SplitNode;
    if (split.direction !== "horizontal" && split.direction !== "vertical") {
      throw new Error(`Invalid template layout at ${path}.direction: expected "horizontal" or "vertical", got ${JSON.stringify(split.direction)}`);
    }
    if (!Array.isArray(split.children) || split.children.length !== 2) {
      throw new Error(`Invalid template layout at ${path}.children: expected exactly two children, got ${Array.isArray(split.children) ? split.children.length : typeof split.children}`);
    }
    validateLayout(split.children[0], `${path}.children[0]`);
    validateLayout(split.children[1], `${path}.children[1]`);
    return;
  }
  if (isPaneNode(node)) {
    const pane = (node as PaneNode).pane;
    if (typeof pane !== "object" || pane === null || !Array.isArray(pane.surfaces)) {
      throw new Error(`Invalid template layout at ${path}.pane.surfaces: expected an array`);
    }
    return;
  }
  throw new Error(`Invalid template layout at ${path}: expected pane or split node`);
}

/** Normalize a command field (string or string[]) into a single shell string, optionally prepending a cd to cwd. */
export function normalizeCommand(cmd: string | string[] | undefined, cwd?: string): string | undefined {
  let result: string | undefined;
  if (cmd == null) {
    result = undefined;
  } else if (Array.isArray(cmd)) {
    result = cmd.join(" && ");
  } else {
    result = cmd;
  }

  if (cwd) {
    return result ? `cd ${cwd} && ${result}` : `cd ${cwd}`;
  }
  return result;
}

// ── Template management ──

const TEMPLATES_DIR = join(homedir(), ".config", "cx", "templates");

function ensureTemplatesDir(): void {
  mkdirSync(TEMPLATES_DIR, { recursive: true });
}

/** Derive a template name from a filename (e.g. "my-template.json" → "my-template"). */
function nameFromFile(filename: string): string {
  return filename.replace(/\.json$/, "");
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
    files.map(async (f) => {
      const t = await Bun.file(join(TEMPLATES_DIR, f)).json() as TemplateConfig;
      if (!t.name) t.name = nameFromFile(f);
      try {
        validateLayout(t.layout);
      } catch (err) {
        throw new Error(`Template "${t.name}" (${f}) is invalid: ${(err as Error).message}`);
      }
      return t;
    }),
  );
}

/** Get a template by name. */
export async function getTemplate(name: string): Promise<TemplateConfig | null> {
  const path = join(TEMPLATES_DIR, `${name}.json`);
  if (!existsSync(path)) return null;
  const t = await Bun.file(path).json() as TemplateConfig;
  if (!t.name) t.name = name;
  try {
    validateLayout(t.layout);
  } catch (err) {
    throw new Error(`Template "${t.name}" (${path}) is invalid: ${(err as Error).message}`);
  }
  return t;
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
    for (const t of data.templates ?? []) {
      try {
        validateLayout(t.layout);
      } catch (err) {
        throw new Error(`Template "${t.name}" in ${localPath} is invalid: ${(err as Error).message}`);
      }
    }
    return { templates: data.templates, projectPath: startDir };
  }

  // Fall back to git root
  let gitRoot = "";
  try {
    const result = Bun.spawnSync(["git", "-C", startDir, "rev-parse", "--show-toplevel"]);
    gitRoot = result.stdout.toString().trim();
  } catch {}

  if (gitRoot && gitRoot !== startDir) {
    const rootPath = join(gitRoot, "cx.json");
    if (existsSync(rootPath)) {
      const data = await Bun.file(rootPath).json() as { templates: TemplateConfig[] };
      for (const t of data.templates ?? []) {
        try {
          validateLayout(t.layout);
        } catch (err) {
          throw new Error(`Template "${t.name}" in ${rootPath} is invalid: ${(err as Error).message}`);
        }
      }
      return { templates: data.templates, projectPath: gitRoot };
    }
  }

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

  // Sort alphabetically by name
  entries.sort((a, b) => a.template.name.localeCompare(b.template.name));

  const choice = await p.autocomplete({
    message: "Select a template",
    options: entries.map((e) => ({
      value: e,
      label: `${pc.bold(e.template.name)}  ${pc.dim(e.template.coder.template)}  ${pc.dim(e.template.type)}${e.isProject ? `  ${pc.dim("(project)")}` : ""}`,
    })),
    placeholder: "Type to filter",
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

