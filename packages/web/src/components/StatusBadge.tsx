const STATUS_STYLES: Record<string, { color: string; label: string }> = {
  running: { color: "var(--green)", label: "Running" },
  stopped: { color: "var(--text-dim)", label: "Stopped" },
  starting: { color: "var(--yellow)", label: "Starting" },
  stopping: { color: "var(--yellow)", label: "Stopping" },
  failed: { color: "var(--red)", label: "Failed" },
  unknown: { color: "var(--text-dim)", label: "Unknown" },
};

function useStatusInfo(status: string, healthy?: boolean) {
  const s = STATUS_STYLES[status] ?? STATUS_STYLES.unknown!;
  const unhealthy = healthy === false && status === "running";
  return {
    dotColor: unhealthy ? "var(--red)" : s.color,
    textColor: unhealthy ? "var(--red)" : s.color,
    label: unhealthy ? "Unhealthy" : s.label,
  };
}

export function StatusDot({ status, healthy }: { status: string; healthy?: boolean }) {
  const { dotColor } = useStatusInfo(status, healthy);
  return (
    <span
      style={{
        width: 8,
        height: 8,
        borderRadius: "50%",
        background: dotColor,
        display: "inline-block",
        flexShrink: 0,
      }}
    />
  );
}

export function StatusText({ status, healthy }: { status: string; healthy?: boolean }) {
  const { textColor, label } = useStatusInfo(status, healthy);
  return <span style={{ color: textColor, fontSize: 13 }}>{label}</span>;
}

export function StatusBadge({ status, healthy }: { status: string; healthy?: boolean }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <StatusDot status={status} healthy={healthy} />
      <StatusText status={status} healthy={healthy} />
    </span>
  );
}
