import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync, readdirSync, unlinkSync, existsSync } from "node:fs";
import { sshHost, sshHostWithSession } from "./ssh.ts";

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
  name?: string;
  session?: string;
  command?: string;
  url?: string;
  focus?: boolean;
}

export function isSplitNode(node: LayoutNode): node is SplitNode {
  return "direction" in node;
}

export function isPaneNode(node: LayoutNode): node is PaneNode {
  return "pane" in node;
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

// ── cmux.json generation ──

/** Marker field to identify cx-generated commands. */
const GENERATED_MARKER = "cx";

interface CmuxCommand {
  name: string;
  keywords?: string[];
  color?: string;
  restart?: string;
  layout: CmuxLayoutNode;
  /** Internal marker — not part of cmux spec but used to track our entries. */
  _generator?: string;
}

type CmuxLayoutNode = CmuxSplitNode | CmuxPaneNode;

interface CmuxSplitNode {
  direction: "horizontal" | "vertical";
  split?: number;
  children: [CmuxLayoutNode, CmuxLayoutNode];
}

interface CmuxPaneNode {
  pane: {
    surfaces: CmuxSurfaceEntry[];
  };
}

interface CmuxSurfaceEntry {
  type: "terminal" | "browser";
  name?: string;
  command?: string;
  url?: string;
}

/**
 * Generate a cmux.json command entry from a template.
 * Terminal commands get wrapped with SSH into the Coder workspace.
 */
export async function generateCmuxCommand(
  template: TemplateConfig,
  coderWorkspace: string,
): Promise<CmuxCommand> {
  return {
    name: `${template.name} (${coderWorkspace})`,
    keywords: ["coder", template.name, coderWorkspace],
    color: template.color,
    restart: "ignore",
    layout: await transformLayoutForSsh(template.layout, coderWorkspace),
    _generator: GENERATED_MARKER,
  };
}

/** Recursively transform layout, wrapping terminal commands with SSH. */
async function transformLayoutForSsh(node: LayoutNode, coderWorkspace: string): Promise<CmuxLayoutNode> {
  if (isSplitNode(node)) {
    return {
      direction: node.direction,
      split: node.split,
      children: [
        await transformLayoutForSsh(node.children[0], coderWorkspace),
        await transformLayoutForSsh(node.children[1], coderWorkspace),
      ],
    };
  }

  return {
    pane: {
      surfaces: await Promise.all(node.pane.surfaces.map(async (s) => {
        if (s.type === "terminal") {
          const host = s.session
            ? await sshHostWithSession(coderWorkspace, s.session)
            : await sshHost(coderWorkspace);
          const remoteCmd = s.command ? ` -t '${s.command}'` : "";
          return {
            type: "terminal" as const,
            name: s.name,
            command: `ssh -R /tmp/cmux.sock:$CMUX_SOCKET_PATH ${host}${remoteCmd}`,
          };
        }
        return {
          type: s.type,
          name: s.name,
          url: s.url,
        };
      })),
    },
  };
}

const CMUX_JSON_PATH = join(homedir(), ".config", "cmux", "cmux.json");

/**
 * Write commands to ~/.config/cmux/cmux.json, merging with existing
 * non-cx entries.
 */
export async function writeCmuxJson(commands: CmuxCommand[]): Promise<void> {
  let existing: CmuxCommand[] = [];
  if (existsSync(CMUX_JSON_PATH)) {
    const data = await Bun.file(CMUX_JSON_PATH).json();
    existing = (data.commands ?? []) as CmuxCommand[];
  }

  // Keep non-cx entries, replace ours
  const preserved = existing.filter((c) => c._generator !== GENERATED_MARKER);
  const merged = [...preserved, ...commands];

  mkdirSync(join(homedir(), ".config", "cmux"), { recursive: true });
  await Bun.write(
    CMUX_JSON_PATH,
    JSON.stringify({ commands: merged }, null, 2) + "\n",
  );
}

/** Remove a generated cmux.json entry by layout name. */
export async function removeCmuxJsonEntry(layoutName: string): Promise<void> {
  if (!existsSync(CMUX_JSON_PATH)) return;
  const data = await Bun.file(CMUX_JSON_PATH).json();
  const commands = (data.commands ?? []) as CmuxCommand[];
  const filtered = commands.filter(
    (c) => !(c._generator === GENERATED_MARKER && c.name.includes(`(${layoutName})`)),
  );
  if (filtered.length === commands.length) return;
  await Bun.write(
    CMUX_JSON_PATH,
    JSON.stringify({ commands: filtered }, null, 2) + "\n",
  );
}
