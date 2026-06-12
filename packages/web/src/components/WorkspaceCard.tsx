import { useState, useEffect, type SyntheticEvent } from "react";
import type { WorkspaceInfo, AppEntry } from "../api";
import { stopWorkspace, startWorkspace, fetchApps, tearDown, streamUpdate, streamRestart, favoriteWorkspace } from "../api";
import { StatusText } from "./StatusBadge";
import { IconMenu, type MenuItem } from "./IconMenu";
import { TerminalSquare, ExternalLink, MoreVertical, Globe, RefreshCw, Square, Play, Download, Trash2, Star, AlertTriangle, Clock, Signal, Loader, CheckCircle, XCircle, Pause, CircleDot, MessageSquare, GitPullRequest } from "lucide-react";
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

function timeUntil(iso: string): string {
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) return "now";
  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

const APP_STATE_STYLES: Record<string, { icon: typeof Loader; color: string }> = {
  working: { icon: Loader, color: "var(--accent)" },
  idle: { icon: Pause, color: "var(--text-dim)" },
  complete: { icon: CheckCircle, color: "var(--green)" },
  failure: { icon: XCircle, color: "var(--red)" },
};

function AppStateIcon({ state }: { state?: string }) {
  const s = APP_STATE_STYLES[state ?? ""] ?? APP_STATE_STYLES.idle!;
  const Icon = s.icon;
  return <Icon size={12} style={{ color: s.color, flexShrink: 0 }} />;
}

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
  const [pinning, setPinning] = useState(false);
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

  const handlePin = async () => {
    setPinning(true);
    await favoriteWorkspace(workspace.name, !workspace.favorite);
    setPinning(false);
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

  // Actions menu: pin + start/stop + tear down
  const actionItems: MenuItem[] = [];
  actionItems.push({
    label: pinning
      ? workspace.favorite
        ? "Unpinning..."
        : "Pinning..."
      : workspace.favorite
        ? "Unpin"
        : "Pin to top",
    icon: <Star size={14} fill={workspace.favorite ? "currentColor" : "none"} />,
    color: "var(--yellow)",
    onClick: handlePin,
    disabled: pinning,
  });
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

  // For task-backed workspaces, the primary destination is the Coder Task UI; otherwise the dashboard.
  const primaryUrl = workspace.task?.url ?? apps?.dashboard;

  const task = workspace.task;
  const taskLinkUrl = task?.uri ?? task?.prUrl;
  const taskLink = taskLinkUrl ? taskLinkMeta(taskLinkUrl) : null;
  const TaskLinkIcon = taskLink?.icon;

  const actionButtons = (
    <div style={{ display: "flex", gap: 6, alignItems: "center", color: btnColor, margin: "-6px 0" }}>
      {taskLink && TaskLinkIcon && (
        <a
          className="icon-btn"
          href={taskLinkUrl!}
          target="_blank"
          rel="noopener noreferrer"
          title={taskLinkUrl}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            height: 26,
            padding: "0 8px",
            borderRadius: "var(--radius)",
            color: "var(--accent)",
            background: "color-mix(in srgb, var(--accent) 10%, transparent)",
            border: "none",
            cursor: "pointer",
            textDecoration: "none",
            flexShrink: 0,
            fontSize: 12,
            fontWeight: 500,
            whiteSpace: "nowrap",
          }}
        >
          <TaskLinkIcon size={13} />
          {taskLink.label}
        </a>
      )}
      {primaryUrl && (
        <a
          className="icon-btn"
          href={primaryUrl}
          target="_blank"
          rel="noopener noreferrer"
          title={workspace.task?.url ? "Task" : "Dashboard"}
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
          <Globe size={16} />
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

  const warnings: Array<{ label: string; color: string }> = [];
  if (workspace.dormantAt) warnings.push({ label: "Dormant", color: "var(--yellow)" });
  if (workspace.deletingAt) warnings.push({ label: `Deleting ${timeUntil(workspace.deletingAt)}`, color: "var(--red)" });
  if (workspace.buildError) warnings.push({ label: "Build error", color: "var(--red)" });

  const templateLabel = workspace.templateDisplayName || workspace.templateName;

  return (
    <div className="workspace-card" style={{ ...card, ...tint, display: "flex", flexDirection: "column", gap: 6 }}>
      {/* Primary heading: task name when available, otherwise workspace name */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
        <span style={{ fontWeight: 600, fontSize: 16, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "inline-flex", alignItems: "center", gap: 6 }}>
          {workspace.favorite && <Star size={13} style={{ color: "var(--yellow)", flexShrink: 0 }} fill="var(--yellow)" />}
          {task ? task.displayName : workspace.name}
        </span>
        {actionButtons}
      </div>


      {/* Agent activity */}
      {workspace.appStatus?.message && (
        <div style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          <AppStateIcon state={workspace.appStatus.state} />
          <span style={{ color: "var(--text-dim)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
            {workspace.appStatus.message}
          </span>
        </div>
      )}

      {/* Warnings */}
      {warnings.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {warnings.map((w) => (
            <span key={w.label} style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 11, color: w.color }}>
              <AlertTriangle size={11} /> {w.label}
            </span>
          ))}
        </div>
      )}

      {/* Status + metadata */}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
        <StatusText status={workspace.status} healthy={workspace.healthy} />
        <span style={dim}>{workspace.buildAge} ago</span>
        <span style={dim}>{templateLabel}</span>
        {workspace.autoStopAt && workspace.status === "running" && (
          <span style={{ ...dim, display: "inline-flex", alignItems: "center", gap: 3 }}>
            <Clock size={10} /> stops {timeUntil(workspace.autoStopAt)}
          </span>
        )}
        {workspace.agent?.latencyMs != null && (
          <span style={{ ...dim, display: "inline-flex", alignItems: "center", gap: 3 }}>
            <Signal size={10} /> {Math.round(workspace.agent.latencyMs)}ms
          </span>
        )}
        {workspace.agent?.arch && (
          <span style={dim}>{workspace.agent.os}/{workspace.agent.arch}</span>
        )}
        {workspace.dailyCost != null && workspace.dailyCost > 0 && (
          <span style={dim}>{workspace.dailyCost}/day</span>
        )}
        {workspace.resourceMeta?.map((m) => (
          <span key={m.key} style={dim} title={m.key}>{m.value}</span>
        ))}
      </div>
    </div>
  );
}

function taskLinkMeta(url: string): { icon: typeof ExternalLink; label: string } {
  const pr = url.match(/github\.com\/[^/]+\/([^/]+)\/pull\/(\d+)/);
  if (pr) return { icon: GitPullRequest, label: `${pr[1]} #${pr[2]}` };

  const issue = url.match(/github\.com\/[^/]+\/([^/]+)\/issues\/(\d+)/);
  if (issue) return { icon: CircleDot, label: `${issue[1]} #${issue[2]}` };

  if (/\.slack\.com\/archives\//.test(url)) return { icon: MessageSquare, label: "Slack" };

  const linear = url.match(/linear\.app\/[^/]+\/issue\/([A-Z]+-\d+)/);
  if (linear) return { icon: ExternalLink, label: linear[1] };

  const jira = url.match(/atlassian\.net\/browse\/([A-Z]+-\d+)/);
  if (jira) return { icon: ExternalLink, label: jira[1] };

  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    const label = host.length > 20 ? host.slice(0, 17) + "…" : host;
    return { icon: ExternalLink, label };
  } catch {
    return { icon: ExternalLink, label: "Link" };
  }
}
