import { useRef, useEffect } from "react";
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

const logBox: React.CSSProperties = {
  marginTop: 8,
  padding: "8px 10px",
  background: "var(--bg)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  maxHeight: 200,
  overflow: "auto",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  fontSize: 11,
  lineHeight: 1.5,
  color: "var(--text-dim)",
  whiteSpace: "pre-wrap",
  wordBreak: "break-all",
};

export function ProgressSteps({
  events,
  currentStage,
}: {
  events: UpEvent[];
  currentStage: string | null;
}) {
  const logRef = useRef<HTMLDivElement>(null);
  const stages = events.filter((e) => e.stage !== "log");
  const logs = events.filter((e) => e.stage === "log").map((e) => e.message);
  const isStreaming = currentStage && currentStage !== "done" && currentStage !== "error";

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [logs.length]);

  return (
    <div style={{ padding: "8px 0" }}>
      {stages.map((event, i) => {
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

      {logs.length > 0 && isStreaming && (
        <div ref={logRef} style={logBox}>
          {logs.join("\n")}
        </div>
      )}
    </div>
  );
}
