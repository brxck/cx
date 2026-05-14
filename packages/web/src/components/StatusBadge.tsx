const STATUS_STYLES: Record<string, { color: string; label: string }> = {
  running: { color: "var(--green)", label: "Running" },
  stopped: { color: "var(--text-dim)", label: "Stopped" },
  starting: { color: "var(--yellow)", label: "Starting" },
  stopping: { color: "var(--yellow)", label: "Stopping" },
  failed: { color: "var(--red)", label: "Failed" },
  unknown: { color: "var(--text-dim)", label: "Unknown" },
};

export function StatusBadge({ status, healthy }: { status: string; healthy?: boolean }) {
  const s = STATUS_STYLES[status] ?? STATUS_STYLES.unknown!;
  const unhealthy = healthy === false && status === "running";
  const dotColor = unhealthy ? "var(--red)" : s.color;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: dotColor,
          display: "inline-block",
        }}
      />
      <span style={{ color: unhealthy ? "var(--red)" : s.color, fontSize: 13 }}>
        {unhealthy ? "Unhealthy" : s.label}
      </span>
    </span>
  );
}
