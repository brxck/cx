import { favoriteWorkspace, unfavoriteWorkspace } from "../lib/coder.ts";

export async function handleFavorite(req: Request): Promise<Response> {
  const body = (await req.json()) as { workspace?: string; favorite?: boolean };

  if (!body.workspace) {
    return Response.json({ ok: false, error: "workspace is required" }, { status: 400 });
  }

  try {
    if (body.favorite === false) {
      await unfavoriteWorkspace(body.workspace);
    } else {
      await favoriteWorkspace(body.workspace);
    }
  } catch (err: any) {
    return Response.json(
      { ok: false, error: err?.message ?? "Failed to update favorite" },
      { status: 500 },
    );
  }

  return Response.json({ ok: true });
}
