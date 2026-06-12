import * as p from "@clack/prompts";
import pc from "picocolors";
import {
  resolveTemplateSource,
  listTemplateSources,
  getProjectTemplateSources,
  templateDisplay,
  ensureDefaultsSeeded,
  type TemplateSource,
} from "./templates.ts";

/**
 * Resolve a template source by name, or fall through to an interactive picker
 * over project-local + global templates (seeding defaults on first run).
 */
export async function resolveSourceOrDefault(
  name: string | undefined,
  opts?: { filter?: (source: TemplateSource) => boolean; noun?: string },
): Promise<{ source: TemplateSource; projectPath: string | null }> {
  await ensureDefaultsSeeded();

  if (name) {
    const resolved = await resolveTemplateSource({ name });
    if (!resolved) {
      p.log.error(`Template ${pc.bold(name)} not found`);
      process.exit(1);
    }
    return { source: resolved.source, projectPath: resolved.projectPath };
  }

  const project = await getProjectTemplateSources();
  const projectSources = project?.sources ?? [];
  const globalSources = await listTemplateSources();

  type PickerEntry = {
    source: TemplateSource;
    origin: "project" | "global";
  };

  let entries: PickerEntry[] = [
    ...projectSources.map((s) => ({ source: s, origin: "project" as const })),
    ...globalSources.map((s) => ({ source: s, origin: "global" as const })),
  ];

  if (opts?.filter) entries = entries.filter((e) => opts.filter!(e.source));

  if (entries.length === 0) {
    p.log.error(`No ${opts?.noun ?? "templates"} available.`);
    process.exit(1);
  }

  entries.sort((a, b) => a.source.name.localeCompare(b.source.name));

  const choice = await p.autocomplete({
    message: "Select a template",
    options: entries.map((e) => ({
      value: e,
      label: renderPickerLabel(e),
    })),
    placeholder: "Type to filter",
  });

  if (p.isCancel(choice)) {
    p.cancel("Cancelled.");
    process.exit(0);
  }
  const picked = choice as PickerEntry;

  return {
    source: picked.source,
    projectPath: picked.origin === "project" ? (project?.projectPath ?? null) : null,
  };
}

export function renderPickerLabel(entry: {
  source: TemplateSource;
  origin: "project" | "global";
}): string {
  const d = templateDisplay(entry.source);
  const projectTag = entry.origin === "project" ? `  ${pc.dim("(project)")}` : "";
  if (d.dynamic) {
    return `${pc.bold(d.name)}  ${pc.dim("(dynamic)")}${projectTag}`;
  }
  return `${pc.bold(d.name)}  ${pc.dim(d.coderTemplate ?? "")}  ${pc.dim(d.type ?? "")}${projectTag}`;
}
