import { listTemplatesAsync, getProjectTemplates } from "../lib/templates.ts";

export async function handleTemplates(): Promise<Response> {
  const [globalTemplates, project] = await Promise.all([
    listTemplatesAsync(),
    getProjectTemplates(),
  ]);

  const projectTemplates = project?.templates ?? [];

  // Merge and dedupe (project-local first)
  const seen = new Set<string>();
  const templates = [];
  for (const t of projectTemplates) {
    seen.add(t.name);
    templates.push({ ...t, source: "project" as const });
  }
  for (const t of globalTemplates) {
    if (!seen.has(t.name)) {
      templates.push({ ...t, source: "global" as const });
    }
  }

  return Response.json({ templates });
}
