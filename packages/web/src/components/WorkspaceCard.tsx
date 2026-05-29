import { useState, useEffect, type SyntheticEvent } from "react";
import type { WorkspaceInfo, AppEntry } from "../api";
import { stopWorkspace, startWorkspace, fetchApps, tearDown, streamUpdate, streamRestart } from "../api";
import { StatusText } from "./StatusBadge";
import { IconMenu, type MenuItem } from "./IconMenu";
import { TerminalSquare, ExternalLink, MoreVertical, LayoutDashboard, RefreshCw, Square, Play, Download, Trash2 } from "lucide-react";
import type { UpEvent } from "../api";

const card: React.CSSProperties = {
  background: "var(--surface)",
  border: "none",
  borderLeft: "3px solid transparent",
  borderRadius: "var(--radius)",
  padding: "14px 16px",
  marginBottom: 8,
};

const dim: React.CSSProperties = { color: "var(--text-dim)", fontSize: 12 };

function AppIcon({ src, size = 14 }: { src: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <ExternalLink size={size} />;
  return (
    <img
      src={src}
      alt=""
      style={{ width: size, height: size }}
      onError={() => setFailed(true)}
    />
  );
}

export function WorkspaceCard({
  workspace,
  onRefresh,
}: {
  workspace: WorkspaceInfo;
  onRefresh: () => void;
}) {
  const [toggling, setToggling] = useState(false);
  const [tearing, setTearing] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [apps, setApps] = useState<{ dashboard: string; terminal: string; apps: AppEntry[] } | null>(null);

  const isRunning = workspace.status === "running";
  const isStopped = workspace.status === "stopped";
  const isUnhealthy = isRunning && !workspace.healthy;

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

  const handleUpdate = async () => {
    setUpdating(true);
    try {
      for await (const event of streamUpdate(workspace.name)) {
        if (event.stage === "error") break;
      }
    } catch {}
    setUpdating(false);
    onRefresh();
  };

  const handleRestart = async () => {
    setRestarting(true);
    try {
      for await (const event of streamRestart(workspace.name)) {
        if (event.stage === "error") break;
      }
    } catch {}
    setRestarting(false);
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

  // Open menu: terminal + extra apps, sorted alphabetically
  const openItems: MenuItem[] = [];
  if (apps) {
    const allApps: MenuItem[] = [
      { label: "Terminal", icon: <TerminalSquare size={14} />, href: apps.terminal },
    ];
    for (const app of apps.apps.filter((a) => a.slug !== "dashboard")) {
      allApps.push({
        label: app.label,
        icon: app.icon ? <AppIcon src={app.icon} /> : <ExternalLink size={14} />,
        href: `${apps.dashboard}/apps/${app.slug}`,
      });
    }
    allApps.sort((a, b) => a.label.localeCompare(b.label));
    openItems.push(...allApps);
  }

  // Actions menu: start/stop + tear down
  const actionItems: MenuItem[] = [];
  if (isRunning) {
    actionItems.push({
      label: restarting ? "Restarting..." : "Restart",
      icon: <RefreshCw size={14} />,
      color: "var(--yellow)",
      onClick: handleRestart,
      disabled: restarting,
    });
    actionItems.push({
      label: toggling ? "Stopping..." : "Stop",
      icon: <Square size={14} />,
      onClick: handleToggle,
      disabled: toggling,
    });
  } else if (isStopped) {
    actionItems.push({
      label: toggling ? "Starting..." : "Start",
      icon: <Play size={14} />,
      color: "var(--green)",
      onClick: handleToggle,
      disabled: toggling,
    });
  }
  actionItems.push({
    label: updating ? "Updating..." : "Update",
    icon: <Download size={14} />,
    color: "var(--accent)",
    onClick: handleUpdate,
    disabled: updating,
  });
  if (workspace.sessions.length > 0) {
    actionItems.push({
      label: tearing ? "Tearing down..." : "Tear Down",
      icon: <Trash2 size={14} />,
      color: "var(--red)",
      onClick: handleTearDown,
      disabled: tearing,
    });
  }

  const btnColor = isUnhealthy ? "var(--yellow)" : isStopped ? "var(--text-dim)" : "var(--accent)";

  const actionButtons = (
    <div style={{ display: "flex", gap: 6, alignItems: "center", color: btnColor, margin: "-6px 0" }}>
      {apps && (
        <a
          className="icon-btn"
          href={apps.dashboard}
          target="_blank"
          rel="noopener noreferrer"
          title="Dashboard"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 32,
            height: 32,
            borderRadius: "var(--radius)",
            color: "inherit",
            background: "transparent",
            border: "none",
            cursor: "pointer",
            textDecoration: "none",
            flexShrink: 0,
            fontSize: 15,
          }}
        >
          <LayoutDashboard size={16} />
        </a>
      )}
      <IconMenu icon={<TerminalSquare size={16} />} items={sessionItems} title="Sessions" color={btnColor} />
      <IconMenu icon={<ExternalLink size={16} />} items={openItems} title="Open" color={btnColor} />
      <IconMenu icon={<MoreVertical size={16} />} items={actionItems} title="Actions" color={btnColor} />
    </div>
  );


  const tint = isUnhealthy
    ? { borderLeft: "3px solid var(--yellow)", background: "color-mix(in srgb, var(--yellow) 6%, var(--surface))" }
    : isRunning
      ? { borderLeft: "3px solid var(--accent)", background: "color-mix(in srgb, var(--accent) 6%, var(--surface))" }
      : {};

  const task = workspace.task;

  return (
    <div className="workspace-card" style={{ ...card, ...tint, display: "flex", flexDirection: "column", gap: 6 }}>
      {/* Workspace name + actions */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
        <span style={{ fontWeight: 600, fontSize: 16, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {workspace.name}
        </span>
        {actionButtons}
      </div>

      {/* Task title */}
      {task && (
        <div style={{ fontSize: 13, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {task.displayName}
        </div>
      )}

      {/* PR link */}
      {task?.prUrl && (
        <a
          href={task.prUrl}
          target="_blank"
          rel="noopener noreferrer"
          title="Open PR"
          style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "var(--accent)", textDecoration: "none", fontSize: 12, alignSelf: "flex-start", maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
        >
          <ExternalLink size={12} style={{ flexShrink: 0 }} /> {prLabel(task.prUrl)}
        </a>
      )}

      {/* Status + timestamp + template */}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
        <StatusText status={workspace.status} healthy={workspace.healthy} />
        <span style={dim}>{workspace.buildAge} ago</span>
        <span style={dim}>{workspace.templateName}</span>
      </div>
    </div>
  );
}

/** Short label for a PR URL, e.g. `Infrastructure #1191`. Falls back to the host path. */
function prLabel(url: string): string {
  const m = url.match(/github\.com\/[^/]+\/([^/]+)\/pull\/(\d+)/);
  if (m) return `${m[1]} #${m[2]}`;
  return url.replace(/^https?:\/\//, "");
}
