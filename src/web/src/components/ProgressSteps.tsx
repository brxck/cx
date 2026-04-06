import type { UpEvent } from "../api";

const STAGE_LABELS: Record<string, string> = {
  creating: "Creating workspace",
  waiting: "Waiting for agent",
  ssh: "Configuring SSH",
  ports: "Port forwarding",
  sessions: "Starting sessions",
  done: "Done",
  error: "Error",
};

const step: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  gap: 12,
  padding: "10px 0",
};

const dot: React.CSSProperties = {
  width: 24,
  height: 24,
  borderRadius: "50%",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: 12,
  flexShrink: 0,
  marginTop: 1,
};

export function ProgressSteps({
  events,
  currentStage,
}: {
  events: UpEvent[];
  currentStage: string | null;
}) {
  return (
    <div style={{ padding: "8px 0" }}>
      {events.map((event, i) => {
        const isActive = event.stage === currentStage;
        const isDone = !isActive && event.stage !== "error";
        const isError = event.stage === "error";

        return (
          <div key={i} style={step}>
            <div
              style={{
                ...dot,
                background: isError
                  ? "var(--red)"
                  : isDone
                    ? "var(--green)"
                    : "var(--accent)",
                color: "#fff",
              }}
            >
              {isError ? "!" : isDone ? "\u2713" : isActive ? "\u00B7\u00B7" : "\u2713"}
            </div>
            <div>
              <div style={{ fontWeight: 500, fontSize: 14 }}>
                {STAGE_LABELS[event.stage] ?? event.stage}
              </div>
              <div style={{ color: "var(--text-dim)", fontSize: 13 }}>
                {event.message}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
