import * as p from "@clack/prompts";
import pc from "picocolors";
import { CoderCommandError, dashboardUrl, getCoderUrl, listWorkspaces } from "./coder.ts";

const ANSI_RE = /\x1b\[[0-9;]*m/g;

/** Strip ANSI codes, collapse whitespace, and truncate to fit on a single spinner line. */
export function formatLogForSpinner(heading: string, line: string): string {
  const clean = line.replace(ANSI_RE, "").replace(/\s+/g, " ").trim();
  if (!clean) return heading;
  const cols = process.stdout.columns || 80;
  // Clack's spinner wraps the full frame `<char>  <msg><dots>` to the terminal
  // width but clears based only on the bare message, so wrapped frames leak.
  // Reserve: spinner char (1) + two spaces (2) + trailing dots up to 3 (3) +
  // our " · " separator (3) + a 1-char safety margin = 10.
  const headingVisible = heading.replace(ANSI_RE, "");
  const reserved = headingVisible.length + 10;
  const max = Math.max(10, cols - reserved);
  const trimmed = clean.length <= max ? clean : clean.slice(0, max - 1) + "…";
  return `${heading} ${pc.dim("·")} ${pc.dim(trimmed)}`;
}

/**
 * Print a failure tail for a coder command, plus a hint for where to see the full logs.
 * Safe to call with any error — only emits the tail block for CoderCommandError.
 */
export async function printCoderFailure(
  err: unknown,
  opts: { workspace: string },
): Promise<void> {
  if (!(err instanceof CoderCommandError)) return;

  if (err.tail.length > 0) {
    p.log.error(`coder ${err.command} failed — last ${err.tail.length} log line${err.tail.length === 1 ? "" : "s"}:`);
    for (const line of err.tail) {
      const clean = line.replace(ANSI_RE, "");
      process.stderr.write(pc.dim(`  ${clean}\n`));
    }
  }

  const url = await resolveDashboardUrl(opts.workspace);
  if (url) {
    p.log.info(`Full logs: ${pc.cyan(url)}  ${pc.dim("(or run " + pc.cyan(`coder logs ${opts.workspace}`) + ")")}`);
  } else {
    p.log.info(`Run ${pc.cyan(`coder logs ${opts.workspace}`)} to see the full output`);
  }
}

async function resolveDashboardUrl(workspace: string): Promise<string | null> {
  try {
    const [ws, base] = await Promise.all([
      listWorkspaces().then((list) => list.find((w) => w.name === workspace)),
      getCoderUrl(),
    ]);
    if (!ws) return null;
    return dashboardUrl(base, ws.owner_name, ws.name);
  } catch {
    return null;
  }
}
