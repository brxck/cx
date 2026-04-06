import { gatherStatus } from "../lib/status.ts";

export async function handleStatus(): Promise<Response> {
  const result = await gatherStatus();
  return Response.json({
    layouts: result.layouts,
    untracked: result.untracked,
  });
}
