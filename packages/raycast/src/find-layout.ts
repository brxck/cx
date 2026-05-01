import { LaunchProps, Toast, showHUD, showToast } from "@raycast/api";
import {
  CxServeUnreachable,
  activateLayout,
  getStatus,
  type LayoutInfo,
} from "./api";

function fuzzyMatch(query: string, text: string): boolean {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (t.includes(q)) return true;
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  return qi === q.length;
}

function score(query: string, layout: LayoutInfo): number {
  const fields = [
    layout.name,
    layout.coderWs,
    layout.template ?? "",
    layout.branch ?? "",
    layout.path ?? "",
  ].filter(Boolean);
  const q = query.toLowerCase();
  let best = -1;
  for (const field of fields) {
    const f = field.toLowerCase();
    if (f === q) return 1000;
    if (f.startsWith(q)) best = Math.max(best, 500 - f.length);
    else if (f.includes(q)) best = Math.max(best, 250 - f.length);
    else if (fuzzyMatch(query, field)) best = Math.max(best, 100 - f.length);
  }
  return best;
}

export default async function Command(
  props: LaunchProps<{ arguments: { query: string } }>,
) {
  const query = props.arguments.query.trim();
  if (!query) {
    await showHUD("Empty query");
    return;
  }

  let status;
  try {
    status = await getStatus();
  } catch (err) {
    if (err instanceof CxServeUnreachable) {
      await showToast({
        style: Toast.Style.Failure,
        title: "cx serve unreachable",
      });
    } else {
      await showToast({
        style: Toast.Style.Failure,
        title: "Failed to fetch layouts",
        message: err instanceof Error ? err.message : String(err),
      });
    }
    return;
  }

  const ranked = status.layouts
    .map((layout) => ({ layout, score: score(query, layout) }))
    .filter((entry) => entry.score >= 0)
    .sort((a, b) => b.score - a.score);

  if (ranked.length === 0) {
    await showHUD(`No match for "${query}"`);
    return;
  }

  const winner = ranked[0]!.layout;
  try {
    await activateLayout(winner.name);
    await showHUD(`Activated ${winner.name}`);
  } catch (err) {
    await showToast({
      style: Toast.Style.Failure,
      title: "Activate failed",
      message: err instanceof Error ? err.message : String(err),
    });
  }
}
