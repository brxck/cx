import * as p from "@clack/prompts";
import {
  isSplitNode,
  isPaneNode,
  type TemplateConfig,
  type LayoutNode,
} from "./templates.ts";

const VAR_PATTERN = /\{\{(\w+)\}\}/g;

/** Extract all unique variable names referenced in a template's layout and ports. */
export function extractVariables(template: TemplateConfig): string[] {
  const names = new Set<string>();

  function scanString(str: string | string[] | undefined): void {
    if (!str) return;
    const strings = Array.isArray(str) ? str : [str];
    for (const s of strings) {
      for (const match of s.matchAll(VAR_PATTERN)) {
        names.add(match[1]!);
      }
    }
  }

  function walkNode(node: LayoutNode): void {
    if (isPaneNode(node)) {
      for (const surface of node.pane.surfaces) {
        scanString(surface.command);
        scanString(surface.url);
      }
    } else if (isSplitNode(node)) {
      walkNode(node.children[0]);
      walkNode(node.children[1]);
    }
  }

  walkNode(template.layout);
  for (const port of template.ports ?? []) {
    scanString(port);
  }

  return [...names];
}

/** Parse a `--vars` CLI string into a record. E.g. `"branch=main,port=3000"` */
export function parseVarsArg(varsArg: string): Record<string, string> {
  if (!varsArg.trim()) return {};
  const result: Record<string, string> = {};
  for (const pair of varsArg.split(",")) {
    const eq = pair.indexOf("=");
    if (eq === -1) continue;
    const key = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (key) result[key] = value;
  }
  return result;
}

/**
 * Resolve all template variables and substitute them in place.
 * Priority: CLI args > template defaults > interactive prompt.
 */
export async function resolveVariables(
  template: TemplateConfig,
  cliVars: Record<string, string>,
): Promise<void> {
  const varNames = extractVariables(template);
  if (varNames.length === 0) return;

  const resolved: Record<string, string> = {};

  for (const name of varNames) {
    if (name in cliVars) {
      resolved[name] = cliVars[name]!;
    } else if (template.variables?.[name]?.default !== undefined) {
      resolved[name] = template.variables[name]!.default!;
    } else {
      const desc = template.variables?.[name]?.description;
      const value = await p.text({
        message: desc ?? `Value for {{${name}}}`,
        placeholder: name,
        validate: (v) => {
          if (!v?.trim()) return `${name} is required`;
        },
      });
      if (p.isCancel(value)) {
        p.cancel("Cancelled.");
        process.exit(0);
      }
      resolved[name] = value;
    }
  }

  substituteVariables(template, resolved);
}

/** Replace all {{var}} placeholders in the template's layout and ports. Mutates in place. */
function substituteVariables(template: TemplateConfig, vars: Record<string, string>): void {
  function replaceVars(str: string): string {
    return str.replace(VAR_PATTERN, (match, name) => {
      return name in vars ? vars[name]! : match;
    });
  }

  function walkNode(node: LayoutNode): void {
    if (isPaneNode(node)) {
      for (const surface of node.pane.surfaces) {
        if (surface.command) {
          surface.command = Array.isArray(surface.command)
            ? surface.command.map(replaceVars)
            : replaceVars(surface.command);
        }
        if (surface.url) surface.url = replaceVars(surface.url);
      }
    } else if (isSplitNode(node)) {
      walkNode(node.children[0]);
      walkNode(node.children[1]);
    }
  }

  walkNode(template.layout);
  if (template.ports) {
    template.ports = template.ports.map(replaceVars);
  }
}
