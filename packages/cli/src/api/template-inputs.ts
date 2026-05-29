import {
  getTemplateSource,
  getProjectTemplateSources,
  describeTemplateInputs,
  type TemplateSource,
} from "../lib/templates.ts";

async function resolveSource(name: string): Promise<TemplateSource | null> {
  const project = await getProjectTemplateSources();
  const local = project?.sources.find((s) => s.name === name);
  if (local) return local;
  return getTemplateSource(name);
}

export async function handleTemplateInputs(req: Request): Promise<Response> {
  const name = new URL(req.url).searchParams.get("template");
  if (!name) {
    return Response.json({ error: "template is required" }, { status: 400 });
  }

  const source = await resolveSource(name);
  if (!source) {
    return Response.json({ error: `Template "${name}" not found` }, { status: 404 });
  }

  try {
    const fields = await describeTemplateInputs(source);
    return Response.json({ fields });
  } catch (err: any) {
    return Response.json(
      { error: `Failed to describe template "${name}": ${err.message ?? "unknown error"}` },
      { status: 500 },
    );
  }
}
