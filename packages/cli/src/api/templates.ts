import {
  listTemplateSources,
  getProjectTemplateSources,
  templateDisplay,
  type TemplateSource,
} from "../lib/templates.ts";

function sourceToApiShape(source: TemplateSource, origin: "project" | "global") {
  const d = templateDisplay(source);
  const base = {
    name: d.name,
    kind: source.kind,
    type: d.type ?? null,
    coderTemplate: d.coderTemplate ?? null,
    color: d.color ?? null,
    dynamic: d.dynamic,
    source: origin,
  };
  if (source.kind === "json") {
    // Include full config for legacy consumers — layout, ports, variables, parameters.
    return {
      ...base,
      coder: source.config.coder,
      ports: source.config.ports ?? null,
      variables: source.config.variables ?? null,
      layout: source.config.layout,
    };
  }
  // JS templates: only publish static meta fields; do not execute the default fn.
  return {
    ...base,
    coder: source.meta?.coder ?? null,
    description: source.meta?.description ?? null,
  };
}

export async function handleTemplates(): Promise<Response> {
  const [globalSources, project] = await Promise.all([
    listTemplateSources(),
    getProjectTemplateSources(),
  ]);
  const projectSources = project?.sources ?? [];

  const seen = new Set<string>();
  const templates: ReturnType<typeof sourceToApiShape>[] = [];
  for (const s of projectSources) {
    seen.add(s.name);
    templates.push(sourceToApiShape(s, "project"));
  }
  for (const s of globalSources) {
    if (seen.has(s.name)) continue;
    templates.push(sourceToApiShape(s, "global"));
  }

  return Response.json({ templates });
}
