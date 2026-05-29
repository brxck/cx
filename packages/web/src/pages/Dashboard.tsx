import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useStatus } from "../hooks/useStatus";
import { WorkspaceCard } from "../components/WorkspaceCard";

type Filter = "all" | "workspaces" | "tasks";

const header: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "12px 0 20px",
};

const fab: React.CSSProperties = {
  padding: "6px 14px",
  borderRadius: "var(--radius)",
  background: "transparent",
  color: "var(--accent)",
  border: "1px solid var(--accent)",
  fontSize: 12,
  fontFamily: "inherit",
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

export function Dashboard() {
  const { data, loading, refresh } = useStatus();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<Filter>("all");

  if (loading && !data) {
    return (
      <div className="dashboard-page" style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ color: "var(--text-dim)" }}>Loading...</span>
      </div>
    );
  }

  const STALE_STOPPED_MS = 24 * 60 * 60 * 1000;
  const allWorkspaces = data?.workspaces ?? [];
  const visible = allWorkspaces.filter((ws) => {
    if (ws.task) return true; // tasks always show, even when stale/stopped
    if (ws.status !== "stopped") return true;
    const age = Date.now() - new Date(ws.lastBuildAt).getTime();
    return age <= STALE_STOPPED_MS;
  });

  const taskCount = visible.filter((w) => w.task).length;
  const wsCount = visible.length - taskCount;

  const workspaces = visible.filter((ws) =>
    filter === "tasks" ? !!ws.task : filter === "workspaces" ? !ws.task : true,
  );
  workspaces.sort((a, b) => (a.status === "running" ? 0 : 1) - (b.status === "running" ? 0 : 1));

  const segments: { key: Filter; label: string; count: number }[] = [
    { key: "all", label: "All", count: visible.length },
    { key: "workspaces", label: "Workspaces", count: wsCount },
    { key: "tasks", label: "Tasks", count: taskCount },
  ];

  return (
    <div className="dashboard-page">
      <div style={header}>
        <h1 style={{ fontSize: 18, fontWeight: 700, color: "var(--accent)", textShadow: "0 0 10px rgba(34,238,136,0.4)", letterSpacing: "0.1em" }}>&gt; cx</h1>
        <button className="fab-btn" style={fab} onClick={() => navigate("/create")}>+ new</button>
      </div>

      <div style={{ display: "flex", marginBottom: 16 }}>
        {segments.map((seg) => {
          const active = filter === seg.key;
          return (
            <button
              key={seg.key}
              className="toggle-seg"
              onClick={() => setFilter(seg.key)}
              style={{
                padding: "5px 12px",
                fontFamily: "inherit",
                fontSize: 11,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                cursor: "pointer",
                border: "none",
                background: active ? "var(--accent)" : "transparent",
                color: active ? "var(--bg)" : "var(--text-dim)",
                fontWeight: active ? 600 : 400,
              }}
            >
              {seg.label} {seg.count}
            </button>
          );
        })}
      </div>

      {workspaces.length > 0 ? (
        workspaces.map((ws) => (
          <WorkspaceCard key={ws.name} workspace={ws} onRefresh={refresh} />
        ))
      ) : (
        <div style={{ textAlign: "center", padding: "60px 0", color: "var(--text-dim)" }}>
          <div style={{ fontSize: 13, marginBottom: 8, letterSpacing: "0.3em" }}>---</div>
          <div style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.08em" }}>no {filter === "tasks" ? "tasks" : "workspaces"}</div>
        </div>
      )}
    </div>
  );
}
