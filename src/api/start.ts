import { startWorkspace, waitForWorkspace } from "../lib/coder.ts";

export async function handleStart(req: Request): Promise<Response> {
  const body = await req.json() as { workspace: string };

  if (!body.workspace) {
    return Response.json({ ok: false, error: "workspace is required" }, { status: 400 });
  }

  try {
    await startWorkspace(body.workspace);
    await waitForWorkspace(body.workspace);
    return Response.json({ ok: true });
  } catch (err: any) {
    return Response.json({ ok: false, error: err.message ?? "Unknown error" }, { status: 500 });
  }
}
