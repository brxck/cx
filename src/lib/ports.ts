export interface PortForwardProcess {
  pid: number;
  workspace: string;
  ports: string[];
}

/** Detect running coder port-forward processes. */
export async function detectPortForwards(): Promise<PortForwardProcess[]> {
  try {
    const result = await Bun.$`ps ax -o pid,command`.quiet().text();
    const processes: PortForwardProcess[] = [];
    for (const line of result.split("\n")) {
      if (!line.includes("coder port-forward")) continue;
      const pidMatch = line.trim().match(/^(\d+)/);
      const wsMatch = line.match(/coder port-forward\s+(\S+)/);
      if (!pidMatch || !wsMatch) continue;
      const portMatches = [...line.matchAll(/--tcp\s+(\S+)/g)];
      processes.push({
        pid: parseInt(pidMatch[1]!, 10),
        workspace: wsMatch[1]!,
        ports: portMatches.map((m) => m[1]!),
      });
    }
    return processes;
  } catch {
    return [];
  }
}

/** Detect running port forwards as a map of workspace → ports (for status.ts compatibility). */
export async function detectPortForwardMap(): Promise<Map<string, string[]>> {
  const processes = await detectPortForwards();
  const map = new Map<string, string[]>();
  for (const proc of processes) {
    if (proc.ports.length > 0) {
      const existing = map.get(proc.workspace) ?? [];
      existing.push(...proc.ports);
      map.set(proc.workspace, existing);
    }
  }
  return map;
}

/** Kill port-forward processes for a workspace. */
export async function stopPortForwards(workspace: string): Promise<number> {
  const processes = await detectPortForwards();
  const matching = processes.filter((p) => p.workspace === workspace);
  let killed = 0;
  for (const proc of matching) {
    try {
      process.kill(proc.pid);
      killed++;
    } catch {}
  }
  return killed;
}
