import { useNavigate } from "react-router-dom";
import { useStatus } from "../hooks/useStatus";
import { WorkspaceCard } from "../components/WorkspaceCard";

const page: React.CSSProperties = {
  maxWidth: 480,
  margin: "0 auto",
  padding: "16px 16px env(safe-area-inset-bottom)",
  minHeight: "100dvh",
};

const header: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "12px 0 20px",
};

const fab: React.CSSProperties = {
  width: 44,
  height: 44,
  borderRadius: "50%",
  background: "var(--accent)",
  color: "#fff",
  border: "none",
  fontSize: 24,
  fontWeight: 300,
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
  background: "var(--surface)",
  borderTop: "1px solid var(--border)",
  padding: "12px 16px calc(12px + env(safe-area-inset-bottom))",
  display: "flex",
  justifyContent: "center",
  gap: 16,
  fontSize: 13,
  color: "var(--text-dim)",
};

export function Dashboard() {
  const { data, loading, refresh } = useStatus();
  const navigate = useNavigate();

  if (loading && !data) {
    return (
      <div style={{ ...page, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ color: "var(--text-dim)" }}>Loading...</span>
      </div>
    );
  }

  const workspaces = data?.workspaces ?? [];
  const running = workspaces.filter((w) => w.status === "running").length;
  const unhealthy = workspaces.filter((w) => w.status === "running" && !w.healthy).length;

  return (
    <div style={page}>
      <div style={header}>
        <h1 style={{ fontSize: 22, fontWeight: 700 }}>cx</h1>
        <button style={fab} onClick={() => navigate("/create")}>+</button>
      </div>

      {workspaces.length > 0 ? (
        workspaces.map((ws) => (
          <WorkspaceCard key={ws.name} workspace={ws} onRefresh={refresh} />
        ))
      ) : (
        <div style={{ textAlign: "center", padding: "60px 0", color: "var(--text-dim)" }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>-</div>
          <div>No workspaces yet</div>
        </div>
      )}

      <div style={{ height: 60 }} />

      <div style={summary}>
        <span>{workspaces.length} workspace{workspaces.length !== 1 ? "s" : ""}</span>
        <span>{running} running</span>
        {unhealthy > 0 && (
          <span style={{ color: "var(--red)" }}>
            {unhealthy} unhealthy
          </span>
        )}
      </div>
    </div>
  );
}
