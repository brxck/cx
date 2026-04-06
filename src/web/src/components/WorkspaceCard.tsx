import { useState, useEffect } from "react";
import type { WorkspaceInfo, AppEntry } from "../api";
import { stopWorkspace, startWorkspace, fetchApps, tearDown } from "../api";
import { StatusBadge } from "./StatusBadge";
import { IconMenu, type MenuItem } from "./IconMenu";
import { TerminalSquare, ExternalLink, MoreVertical } from "lucide-react";

const card: React.CSSProperties = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius)",
  padding: 16,
  marginBottom: 12,
};

const dim: React.CSSProperties = { color: "var(--text-dim)", fontSize: 13 };

export function WorkspaceCard({
  workspace,
  onRefresh,
}: {
  workspace: WorkspaceInfo;
  onRefresh: () => void;
}) {
  const [toggling, setToggling] = useState(false);
  const [tearing, setTearing] = useState(false);
  const [apps, setApps] = useState<{ dashboard: string; terminal: string; apps: AppEntry[] } | null>(null);

  const isRunning = workspace.status === "running";
  const isStopped = workspace.status === "stopped";

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

  const handleTearDown = async () => {
    setTearing(true);
    await tearDown(workspace.name, true);
    setTearing(false);
    onRefresh();
  };

  // Sessions menu: web terminals attached to ZMX sessions
  const sessionItems: MenuItem[] = [];
  if (apps && workspace.sessions.length > 0) {
    for (const session of workspace.sessions) {
      const cmd = `zmx attach ${session}`;
      const url = `${apps.terminal}?command=${encodeURIComponent(cmd)}`;
      sessionItems.push({ label: session, href: url });
    }
  }

  // Open menu: terminal + extra apps
  const openItems: MenuItem[] = [];
  if (apps) {
    openItems.push({ label: "Terminal", href: apps.terminal });
    for (const app of apps.apps.filter((a) => a.slug !== "dashboard")) {
      openItems.push({ label: app.label, href: `${apps.dashboard}/apps/${app.slug}` });
    }
  }

  // Actions menu: dashboard + start/stop + tear down
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
  if (workspace.sessions.length > 0) {
    actionItems.push({
      label: tearing ? "Tearing down..." : "Tear Down",
      color: "var(--red)",
      onClick: handleTearDown,
      disabled: tearing,
    });
  }

  return (
    <div style={card}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 4 }}>
            {workspace.name}
          </div>
          <StatusBadge status={workspace.status} />
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <IconMenu icon={<TerminalSquare size={16} />} items={sessionItems} title="Sessions" />
          <IconMenu icon={<ExternalLink size={16} />} items={openItems} title="Open" />
          <IconMenu icon={<MoreVertical size={16} />} items={actionItems} title="Actions" />
        </div>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <span style={dim}>{workspace.templateName}</span>
        <span style={dim}>{workspace.buildAge} ago</span>
        {workspace.sessions.length > 0 && (
          <span style={dim}>
            {workspace.sessions.length} session{workspace.sessions.length !== 1 ? "s" : ""}
          </span>
        )}
      </div>
    </div>
  );
}
