import { useState, useEffect } from "react";
import type { LayoutStatus, AppEntry } from "../api";
import { StatusBadge } from "./StatusBadge";
import { IconMenu, type MenuItem } from "./IconMenu";
import { tearDown, fetchApps, startWorkspace, stopWorkspace } from "../api";
import { TerminalSquare, ExternalLink, MoreVertical } from "lucide-react";

const card: React.CSSProperties = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius)",
  padding: 16,
  marginBottom: 12,
};

const dim: React.CSSProperties = { color: "var(--text-dim)", fontSize: 13 };

export function LayoutCard({
  layout,
  onRefresh,
}: {
  layout: LayoutStatus;
  onRefresh: () => void;
}) {
  const [tearing, setTearing] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [apps, setApps] = useState<{ dashboard: string; terminal: string; apps: AppEntry[] } | null>(null);

  const isRunning = layout.coderStatus === "running";
  const isStopped = layout.coderStatus === "stopped";

  useEffect(() => {
    fetchApps(layout.coderWorkspace).then(setApps).catch(() => {});
  }, [layout.coderWorkspace]);

  const handleToggle = async () => {
    setToggling(true);
    if (isRunning) {
      await stopWorkspace(layout.coderWorkspace);
    } else {
      await startWorkspace(layout.coderWorkspace);
    }
    setToggling(false);
    onRefresh();
  };

  const handleTearDown = async () => {
    setTearing(true);
    await tearDown(layout.name, true);
    setTearing(false);
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
  actionItems.push({
    label: tearing ? "Tearing down..." : "Tear Down",
    color: "var(--red)",
    onClick: handleTearDown,
    disabled: tearing,
  });

  // Sessions menu: web terminals attached to ZMX sessions
  const sessionItems: MenuItem[] = [];
  if (apps && layout.sessions.length > 0) {
    for (const session of layout.sessions) {
      const cmd = `zmx attach ${session}`;
      const url = `${apps.terminal}?command=${encodeURIComponent(cmd)}`;
      sessionItems.push({ label: session, href: url });
    }
  }

  return (
    <div style={card}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 4 }}>
            {layout.name}
          </div>
          <StatusBadge status={layout.coderStatus} />
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <IconMenu icon={<TerminalSquare size={16} />} items={sessionItems} title="Sessions" />
          <IconMenu icon={<ExternalLink size={16} />} items={openItems} title="Open" />
          <IconMenu icon={<MoreVertical size={16} />} items={actionItems} title="Actions" />
        </div>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 4 }}>
        {layout.coderTemplateName && <span style={dim}>{layout.coderTemplateName}</span>}
        {layout.gitBranch && (
          <span style={dim}>
            {layout.gitBranch}
            {layout.gitDirty && <span style={{ color: "var(--yellow)" }}> *</span>}
          </span>
        )}
        <span style={dim}>{layout.coderBuildAge} ago</span>
      </div>

      {layout.sessions.length > 0 && (
        <div style={dim}>
          {layout.sessions.length} session{layout.sessions.length !== 1 ? "s" : ""}
        </div>
      )}

      {layout.portForwards.length > 0 && (
        <div style={dim}>Ports: {layout.portForwards.join(", ")}</div>
      )}

      {layout.claudeStatus && (
        <div style={{ ...dim, color: layout.claudeStatus === "running" ? "var(--accent)" : undefined }}>
          Claude: {layout.claudeStatus}
        </div>
      )}
    </div>
  );
}
