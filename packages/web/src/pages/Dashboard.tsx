import { useNavigate } from "react-router-dom";
import { useStatus } from "../hooks/useStatus";
import { WorkspaceCard } from "../components/WorkspaceCard";

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

const summary: React.CSSProperties = {
  position: "fixed" as const,
  bottom: 0,
  left: 0,
  right: 0,
  background: "var(--bg)",
  borderTop: "1px solid var(--border)",
  padding: "10px 16px calc(10px + env(safe-area-inset-bottom))",
  display: "flex",
  justifyContent: "center",
  gap: 8,
  fontSize: 11,
  color: "var(--text-dim)",
  textTransform: "uppercase",
  letterSpacing: "0.06em",
};

export function Dashboard() {
  const { data, loading, refresh } = useStatus();
  const navigate = useNavigate();

  if (loading && !data) {
    return (
      <div className="dashboard-page" style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ color: "var(--text-dim)" }}>Loading...</span>
      </div>
    );
  }

  const STALE_STOPPED_MS = 24 * 60 * 60 * 1000;
  const allWorkspaces = data?.workspaces ?? [];
  const workspaces = allWorkspaces.filter((ws) => {
    if (ws.status !== "stopped") return true;
    const age = Date.now() - new Date(ws.lastBuildAt).getTime();
    return age <= STALE_STOPPED_MS;
  });
  workspaces.sort((a, b) => (a.status === "running" ? 0 : 1) - (b.status === "running" ? 0 : 1));
  const running = workspaces.filter((w) => w.status === "running").length;
  const unhealthy = workspaces.filter((w) => w.status === "running" && !w.healthy).length;

  return (
    <div className="dashboard-page">
      <div style={header}>
        <h1 style={{ fontSize: 18, fontWeight: 700, color: "var(--accent)", textShadow: "0 0 10px rgba(34,238,136,0.4)", letterSpacing: "0.1em" }}>&gt; cx</h1>
        <button style={fab} onClick={() => navigate("/create")}>+ new</button>
      </div>

      {workspaces.length > 0 ? (
        workspaces.map((ws) => (
          <WorkspaceCard key={ws.name} workspace={ws} onRefresh={refresh} />
        ))
      ) : (
        <div style={{ textAlign: "center", padding: "60px 0", color: "var(--text-dim)" }}>
          <div style={{ fontSize: 13, marginBottom: 8, letterSpacing: "0.3em" }}>---</div>
          <div style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.08em" }}>no workspaces</div>
        </div>
      )}

      <div style={{ height: 60 }} />

      <div style={summary}>
        <span>{workspaces.length} workspace{workspaces.length !== 1 ? "s" : ""}</span>
        <span style={{ color: "var(--border)" }}>│</span>
        <span>{running} running</span>
        {unhealthy > 0 && (
          <>
            <span style={{ color: "var(--border)" }}>│</span>
            <span style={{ color: "var(--yellow)" }}>
              {unhealthy} unhealthy
            </span>
          </>
        )}
      </div>
    </div>
  );
}
