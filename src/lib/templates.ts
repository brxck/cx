import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { mkdirSync, readdirSync, unlinkSync, existsSync, statSync } from "node:fs";
import consola from "consola";
import type { InputHelpers, ResolvedInputs } from "./input.ts";
import { createInputHelpers } from "./input.ts";
import type { WorkspaceContext } from "./coder.ts";

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

// ── JS/TS template types ──

/** Optional static metadata exported alongside the default function for fast picker display. */
export interface TemplateMeta {
  name?: string;
  coder?: { template: string; preset?: string };
  type?: "ephemeral" | "persistent";
  color?: string;
  description?: string;
}

/** Layout can be a static tree (legacy) or an async fn receiving live workspace context. */
export type DynamicLayout =
  | LayoutNode
  | ((ctx: { workspace: WorkspaceContext }) => LayoutNode | Promise<LayoutNode>);

/** Ports can be a static list or an async fn receiving live workspace context. */
export type DynamicPorts =
  | string[]
  | ((ctx: { workspace: WorkspaceContext }) => string[] | Promise<string[]>);

export interface TemplateReturn {
  name?: string;
  coder: {
    template: string;
    parameters?: Record<string, string>;
    preset?: string;
  };
  type: "ephemeral" | "persistent";
  color?: string;
  ports?: DynamicPorts;
  layout: DynamicLayout;
}

export interface TemplateFnContext {
  input: InputHelpers;
}

export type TemplateFn = (ctx: TemplateFnContext) => TemplateReturn | Promise<TemplateReturn>;

/** A loaded template, either a parsed JSON config or a JS/TS module default export. */
export type TemplateSource =
  | { kind: "json"; name: string; filePath: string; config: TemplateConfig }
  | { kind: "js"; name: string; filePath: string; fn: TemplateFn; meta?: TemplateMeta };

/** Picker-friendly view of a source, built without executing the JS function. */
export interface TemplateDisplay {
  name: string;
  coderTemplate: string | undefined;
  type: "ephemeral" | "persistent" | undefined;
  color?: string;
  dynamic: boolean;
}

// ── Validation & helpers ──

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

/** Picker-friendly view built without running a JS template's default fn. */
export function templateDisplay(source: TemplateSource): TemplateDisplay {
  if (source.kind === "json") {
    return {
      name: source.name,
      coderTemplate: source.config.coder.template,
      type: source.config.type,
      color: source.config.color,
      dynamic: false,
    };
  }
  return {
    name: source.name,
    coderTemplate: source.meta?.coder?.template,
    type: source.meta?.type,
    color: source.meta?.color,
    dynamic: !source.meta,
  };
}

// ── Template management ──

const TEMPLATES_DIR = join(homedir(), ".config", "cx", "templates");
const JS_EXTENSIONS = [".ts", ".js", ".mjs", ".mts"];

function ensureTemplatesDir(): void {
  mkdirSync(TEMPLATES_DIR, { recursive: true });
}

/** Derive a template name from a filename (e.g. "my-template.json" → "my-template"). */
function nameFromFile(filename: string): string {
  return filename.replace(/\.(json|ts|js|mjs|mts)$/, "");
}

function isJsExt(filename: string): boolean {
  return JS_EXTENSIONS.some((ext) => filename.endsWith(ext));
}

function isJsonExt(filename: string): boolean {
  return filename.endsWith(".json");
}

/** Load a JSON template file. */
async function loadJsonSource(filePath: string, explicitName?: string): Promise<TemplateSource> {
  const config = (await Bun.file(filePath).json()) as TemplateConfig;
  const name = explicitName ?? config.name ?? nameFromFile(filePath.split("/").pop()!);
  if (!config.name) config.name = name;
  try {
    validateLayout(config.layout);
  } catch (err) {
    throw new Error(`Template "${name}" (${filePath}) is invalid: ${(err as Error).message}`);
  }
  return { kind: "json", name, filePath, config };
}

/** Load a JS/TS template module by importing it and reading its default/meta exports. */
async function loadJsSource(filePath: string, explicitName?: string): Promise<TemplateSource> {
  const url = pathToFileURL(filePath).href;
  const mod = await import(url);
  const fn = mod.default as unknown;
  if (typeof fn !== "function") {
    throw new Error(`Template ${filePath} must default-export a function`);
  }
  const meta = mod.meta as TemplateMeta | undefined;
  const name = explicitName ?? meta?.name ?? nameFromFile(filePath.split("/").pop()!);
  return { kind: "js", name, filePath, fn: fn as TemplateFn, meta };
}

async function loadSource(filePath: string, explicitName?: string): Promise<TemplateSource> {
  if (isJsonExt(filePath)) return loadJsonSource(filePath, explicitName);
  if (isJsExt(filePath)) return loadJsSource(filePath, explicitName);
  throw new Error(`Unsupported template file extension: ${filePath}`);
}

/** List all template sources in a directory (JSON + JS/TS). */
async function listSourcesInDir(dir: string): Promise<TemplateSource[]> {
  if (!existsSync(dir)) return [];
  const stat = statSync(dir);
  if (!stat.isDirectory()) return [];
  const files = readdirSync(dir).filter((f) => isJsonExt(f) || isJsExt(f));
  const sources: TemplateSource[] = [];
  const seen = new Set<string>();
  for (const f of files) {
    try {
      const src = await loadSource(join(dir, f));
      if (seen.has(src.name)) continue;
      seen.add(src.name);
      sources.push(src);
    } catch (err) {
      consola.warn(`Skipping invalid template: ${(err as Error).message}`);
    }
  }
  return sources;
}

/** List all saved global templates (sources). */
export async function listTemplateSources(): Promise<TemplateSource[]> {
  ensureTemplatesDir();
  return listSourcesInDir(TEMPLATES_DIR);
}

/** @deprecated Prefer listTemplateSources. Returns only JSON templates' TemplateConfig for legacy callers. */
export async function listTemplatesAsync(): Promise<TemplateConfig[]> {
  const sources = await listTemplateSources();
  return sources.filter((s): s is Extract<TemplateSource, { kind: "json" }> => s.kind === "json").map((s) => s.config);
}

/** Get a template source by name (global scope). */
export async function getTemplateSource(name: string): Promise<TemplateSource | null> {
  ensureTemplatesDir();
  const tryExts = [".json", ".ts", ".js", ".mjs", ".mts"];
  for (const ext of tryExts) {
    const path = join(TEMPLATES_DIR, `${name}${ext}`);
    if (existsSync(path)) return loadSource(path, name);
  }
  return null;
}

/** @deprecated Returns JSON TemplateConfig only. Use getTemplateSource + materializeTemplate. */
export async function getTemplate(name: string): Promise<TemplateConfig | null> {
  const src = await getTemplateSource(name);
  if (!src) return null;
  if (src.kind !== "json") return null;
  return src.config;
}

/** Save a JSON template. */
export async function saveTemplate(template: TemplateConfig): Promise<void> {
  ensureTemplatesDir();
  await Bun.write(
    join(TEMPLATES_DIR, `${template.name}.json`),
    JSON.stringify(template, null, 2) + "\n",
  );
}

/** Load project-local template sources from cx.json and/or cx/templates/. */
export async function getProjectTemplateSources(
  dir?: string,
): Promise<{ sources: TemplateSource[]; projectPath: string } | null> {
  const startDir = dir ?? process.cwd();

  async function collectForRoot(rootDir: string): Promise<TemplateSource[] | null> {
    const sources: TemplateSource[] = [];
    const seen = new Set<string>();

    // cx.json — may contain { templates: TemplateConfig[] }
    const jsonPath = join(rootDir, "cx.json");
    if (existsSync(jsonPath)) {
      const data = (await Bun.file(jsonPath).json()) as { templates?: TemplateConfig[] };
      for (const t of data.templates ?? []) {
        try {
          validateLayout(t.layout);
        } catch (err) {
          throw new Error(`Template "${t.name}" in ${jsonPath} is invalid: ${(err as Error).message}`);
        }
        if (seen.has(t.name)) continue;
        seen.add(t.name);
        sources.push({ kind: "json", name: t.name, filePath: jsonPath, config: t });
      }
    }

    // cx/templates/ — one file per template (JSON/TS/JS)
    const templatesDir = join(rootDir, "cx", "templates");
    for (const src of await listSourcesInDir(templatesDir)) {
      if (seen.has(src.name)) continue;
      seen.add(src.name);
      sources.push(src);
    }

    return sources.length ? sources : null;
  }

  const direct = await collectForRoot(startDir);
  if (direct) return { sources: direct, projectPath: startDir };

  // Fall back to git root
  let gitRoot = "";
  try {
    const result = Bun.spawnSync(["git", "-C", startDir, "rev-parse", "--show-toplevel"]);
    gitRoot = result.stdout.toString().trim();
  } catch {}

  if (gitRoot && gitRoot !== startDir) {
    const fromGit = await collectForRoot(gitRoot);
    if (fromGit) return { sources: fromGit, projectPath: gitRoot };
  }

  return null;
}

/** @deprecated Returns TemplateConfig[] for JSON-only legacy callers. */
export async function getProjectTemplates(
  dir?: string,
): Promise<{ templates: TemplateConfig[]; projectPath: string } | null> {
  const res = await getProjectTemplateSources(dir);
  if (!res) return null;
  const templates = res.sources
    .filter((s): s is Extract<TemplateSource, { kind: "json" }> => s.kind === "json")
    .map((s) => s.config);
  return { templates, projectPath: res.projectPath };
}

/** Resolve a template source by name (project-local → global), or interactive picker. */
export async function resolveTemplateSource(opts?: {
  name?: string;
  cwd?: string;
}): Promise<{ source: TemplateSource; projectPath: string | null } | null> {
  const project = await getProjectTemplateSources(opts?.cwd);
  const projectSources = project?.sources ?? [];
  const projectPath = project?.projectPath ?? null;

  if (opts?.name) {
    const local = projectSources.find((s) => s.name === opts.name);
    if (local) return { source: local, projectPath };
    const global = await getTemplateSource(opts.name);
    if (global) return { source: global, projectPath: null };
    return null;
  }

  const globalSources = await listTemplateSources();

  type PickerEntry = { source: TemplateSource; isProject: boolean };
  const entries: PickerEntry[] = [
    ...projectSources.map((s) => ({ source: s, isProject: true })),
    ...globalSources.map((s) => ({ source: s, isProject: false })),
  ];

  if (entries.length === 0) return null;

  const pc = (await import("picocolors")).default;
  const p = await import("@clack/prompts");

  entries.sort((a, b) => a.source.name.localeCompare(b.source.name));

  const choice = await p.autocomplete({
    message: "Select a template",
    options: entries.map((e) => {
      const d = templateDisplay(e.source);
      const label = d.dynamic
        ? `${pc.bold(d.name)}  ${pc.dim("(dynamic)")}${e.isProject ? `  ${pc.dim("(project)")}` : ""}`
        : `${pc.bold(d.name)}  ${pc.dim(d.coderTemplate ?? "")}  ${pc.dim(d.type ?? "")}${e.isProject ? `  ${pc.dim("(project)")}` : ""}`;
      return { value: e, label };
    }),
    placeholder: "Type to filter",
  });

  if (p.isCancel(choice)) {
    p.cancel("Cancelled.");
    process.exit(0);
  }

  const picked = choice as PickerEntry;
  return {
    source: picked.source,
    projectPath: picked.isProject ? projectPath : null,
  };
}

/** @deprecated Resolves JSON templates into TemplateConfig directly. */
export async function resolveTemplate(opts?: {
  name?: string;
  cwd?: string;
}): Promise<{ template: TemplateConfig; projectPath: string | null } | null> {
  const res = await resolveTemplateSource(opts);
  if (!res) return null;
  if (res.source.kind !== "json") return null;
  return { template: res.source.config, projectPath: res.projectPath };
}

/** Delete a template by name. Returns true if any matching file existed. */
export function deleteTemplate(name: string): boolean {
  let removed = false;
  for (const ext of [".json", ".ts", ".js", ".mjs", ".mts"]) {
    const path = join(TEMPLATES_DIR, `${name}${ext}`);
    if (existsSync(path)) {
      unlinkSync(path);
      removed = true;
    }
  }
  return removed;
}

// ── Materialization ──

export interface MaterializeOptions {
  cliVars?: Record<string, string>;
  persistedVars?: ResolvedInputs;
  /** Thunk invoked lazily when a JS template's layout or ports is a function. */
  workspaceFactory?: () => Promise<WorkspaceContext>;
  /**
   * When false, the materializer never prompts — it resolves via persisted →
   * cli → default and throws if none applies. Defaults to true.
   */
  interactive?: boolean;
}

export interface MaterializedTemplate {
  template: TemplateConfig;
  resolvedInputs: ResolvedInputs;
}

/**
 * Phase 1 output — the template function has run (inputs collected), but any
 * dynamic `layout` / `ports` functions have not yet. The caller can inspect
 * `coder` to orchestrate workspace lifecycle, then call `finalize()`.
 */
export interface PreparedTemplate {
  name: string;
  coder: TemplateConfig["coder"];
  type: "ephemeral" | "persistent";
  color?: string;
  /** True when layout or ports is a function — finalize() requires a WorkspaceContext. */
  needsWorkspace: boolean;
  resolvedInputs: ResolvedInputs;
  /** Resolve layout + ports into a final TemplateConfig. */
  finalize(opts?: { workspace?: WorkspaceContext }): Promise<TemplateConfig>;
}

/**
 * Phase 1: resolve inputs and surface the template's coder config, without
 * yet evaluating dynamic layout / ports. Callers can then orchestrate the
 * Coder workspace before calling `finalize()`.
 */
export async function prepareTemplate(
  source: TemplateSource,
  opts: Omit<MaterializeOptions, "workspaceFactory"> = {},
): Promise<PreparedTemplate> {
  if (source.kind === "json") {
    const cloned: TemplateConfig = structuredClone(source.config);
    const { resolveVariables } = await import("./variables.ts");
    await resolveVariables(cloned, opts.cliVars ?? {}, { interactive: opts.interactive });
    return {
      name: cloned.name,
      coder: cloned.coder,
      type: cloned.type,
      color: cloned.color,
      needsWorkspace: false,
      resolvedInputs: {},
      async finalize() {
        return cloned;
      },
    };
  }

  const { input, resolvedInputs } = createInputHelpers({
    cliVars: opts.cliVars,
    persistedVars: opts.persistedVars,
    interactive: opts.interactive,
  });
  const returned = await source.fn({ input });
  const name = returned.name ?? source.name;

  const layoutIsFn = typeof returned.layout === "function";
  const portsIsFn = typeof returned.ports === "function";

  return {
    name,
    coder: returned.coder,
    type: returned.type,
    color: returned.color,
    needsWorkspace: layoutIsFn || portsIsFn,
    resolvedInputs,
    async finalize(finalizeOpts): Promise<TemplateConfig> {
      let layout: LayoutNode;
      if (typeof returned.layout === "function") {
        if (!finalizeOpts?.workspace) {
          throw new Error(
            `Template "${name}" uses a dynamic layout — finalize() requires workspace context`,
          );
        }
        layout = await returned.layout({ workspace: finalizeOpts.workspace });
      } else {
        layout = returned.layout;
      }
      validateLayout(layout);

      let ports: string[] | undefined;
      if (returned.ports !== undefined) {
        if (typeof returned.ports === "function") {
          if (!finalizeOpts?.workspace) {
            throw new Error(
              `Template "${name}" uses a dynamic ports — finalize() requires workspace context`,
            );
          }
          ports = await returned.ports({ workspace: finalizeOpts.workspace });
        } else {
          ports = returned.ports;
        }
      }

      return {
        name,
        coder: returned.coder,
        type: returned.type,
        color: returned.color,
        ports,
        layout,
      };
    },
  };
}

/**
 * Convenience wrapper that runs phase 1 and phase 2 in one call.
 *
 * If the template needs a workspace (dynamic layout/ports) but no factory was
 * provided, `finalize()` throws. Useful for callers that already have (or can
 * cheaply build) a WorkspaceContext — e.g. restore, port-forward.
 */
export async function materializeTemplate(
  source: TemplateSource,
  opts: MaterializeOptions = {},
): Promise<MaterializedTemplate> {
  const prepared = await prepareTemplate(source, {
    cliVars: opts.cliVars,
    persistedVars: opts.persistedVars,
    interactive: opts.interactive,
  });
  let workspace: WorkspaceContext | undefined;
  if (prepared.needsWorkspace && opts.workspaceFactory) {
    workspace = await opts.workspaceFactory();
  }
  const template = await prepared.finalize({ workspace });
  return { template, resolvedInputs: prepared.resolvedInputs };
}
