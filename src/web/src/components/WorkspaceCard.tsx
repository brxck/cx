import { useState, useEffect } from "react";
import type { CoderWorkspace, AppEntry } from "../api";
import { stopWorkspace, startWorkspace, fetchApps } from "../api";
import { StatusBadge } from "./StatusBadge";
import { IconMenu, type MenuItem } from "./IconMenu";
import { ExternalLink, MoreVertical } from "lucide-react";

function workspaceStatus(ws: CoderWorkspace): string {
  const { status, transition } = ws.latest_build;
  if (status === "running" && transition === "start") return "running";
  if (status === "running" && transition === "stop") return "stopped";
  if (status === "succeeded" && transition === "stop") return "stopped";
  if (status === "starting") return "starting";
  if (status === "stopping") return "stopping";
  if (status === "failed") return "failed";
  if (transition === "stop") return "stopped";
  if (transition === "start") return "running";
  return "unknown";
}

const card: React.CSSProperties = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius)",
  padding: 16,
  marginBottom: 12,
  opacity: 0.7,
};

const dim: React.CSSProperties = { color: "var(--text-dim)", fontSize: 13 };

export function WorkspaceCard({
  workspace,
  onRefresh,
}: {
  workspace: CoderWorkspace;
  onRefresh: () => void;
}) {
  const [toggling, setToggling] = useState(false);
  const [apps, setApps] = useState<{ dashboard: string; terminal: string; apps: AppEntry[] } | null>(null);
  const status = workspaceStatus(workspace);
  const isRunning = status === "running";
  const isStopped = status === "stopped";

  useEffect(() => {
    fetchApps(workspace.name).then(setApps).catch(() => {});
  }, [workspace.name]);

  const handleToggle = async () => {
    setToggling(true);
    if (isRunning) {
      await stopWorkspace(workspace.name);
    } else {
      await startWorkspace(workspace.name);
    }
    setToggling(false);
    onRefresh();
  };

  // Open menu: terminal + extra apps
  const openItems: MenuItem[] = [];
  if (apps) {
    openItems.push({ label: "Terminal", href: apps.terminal });
    for (const app of apps.apps.filter((a) => a.slug !== "dashboard")) {
      openItems.push({ label: app.label, href: `${apps.dashboard}/apps/${app.slug}` });
    }
  }

  // Actions menu: dashboard + start/stop
  const actionItems: MenuItem[] = [];
  if (apps) {
    actionItems.push({ label: "Dashboard", href: apps.dashboard, color: "var(--accent)" });
  }
  if (isRunning) {
    actionItems.push({
      label: toggling ? "Stopping..." : "Stop",
      onClick: handleToggle,
      disabled: toggling,
    });
  } else if (isStopped) {
    actionItems.push({
      label: toggling ? "Starting..." : "Start",
      color: "var(--green)",
      onClick: handleToggle,
      disabled: toggling,
    });
  }

  return (
    <div style={card}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 500, fontSize: 15, marginBottom: 4 }}>
            {workspace.name}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <StatusBadge status={status} />
            <span style={dim}>{workspace.template_name}</span>
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <IconMenu icon={<ExternalLink size={16} />} items={openItems} title="Open" />
          <IconMenu icon={<MoreVertical size={16} />} items={actionItems} title="Actions" />
        </div>
      </div>
    </div>
  );
}
