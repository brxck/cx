import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTemplates } from "../hooks/useTemplates";
import { useUpStream } from "../hooks/useUpStream";
import { ProgressSteps } from "../components/ProgressSteps";

const backBtn: React.CSSProperties = {
  background: "none",
  border: "none",
  color: "var(--accent)",
  fontSize: 13,
  fontFamily: "inherit",
  letterSpacing: "0.05em",
  textTransform: "uppercase",
  cursor: "pointer",
  padding: "8px 0",
  marginBottom: 8,
};

const input: React.CSSProperties = {
  width: "100%",
  padding: "10px 14px",
  borderRadius: "var(--radius)",
  border: "1px solid var(--border)",
  background: "var(--surface)",
  color: "var(--text)",
  fontSize: 14,
  fontFamily: "inherit",
  letterSpacing: "0.02em",
  outline: "none",
};

const templateCard: React.CSSProperties = {
  padding: "12px 14px",
  borderRadius: "var(--radius)",
  border: "1px solid var(--border)",
  background: "var(--surface)",
  marginBottom: 8,
  cursor: "pointer",
};

const templateCardSelected: React.CSSProperties = {
  ...templateCard,
  border: "1px solid var(--accent)",
  background: "var(--surface-hover)",
  boxShadow: "0 0 8px rgba(34, 238, 136, 0.15)",
};

const createBtn: React.CSSProperties = {
  width: "100%",
  padding: "12px",
  borderRadius: "var(--radius)",
  border: "1px solid var(--accent)",
  background: "transparent",
  color: "var(--accent)",
  fontSize: 13,
  fontWeight: 500,
  fontFamily: "inherit",
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  cursor: "pointer",
  marginTop: 16,
};

const createBtnDisabled: React.CSSProperties = {
  ...createBtn,
  opacity: 0.3,
  cursor: "not-allowed",
};

export function CreateWorkspace() {
  const navigate = useNavigate();
  const { templates, loading: templatesLoading } = useTemplates();
  const { events, state, error, start, reset } = useUpStream();

  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const [workspaceName, setWorkspaceName] = useState("");

  const handleCreate = () => {
    if (!selectedTemplate || !workspaceName.trim()) return;
    start(selectedTemplate, workspaceName.trim());
  };

  // When selecting a template, pre-fill workspace name
  const handleSelectTemplate = (name: string) => {
    setSelectedTemplate(name);
    if (!workspaceName) {
      setWorkspaceName(name);
    }
  };

  // SSE streaming or done
  if (state !== "idle") {
    const stageEvents = events.filter((e) => e.stage !== "log");
    const currentStage = stageEvents.length > 0 ? stageEvents[stageEvents.length - 1]!.stage : null;

    return (
      <div className="create-page">
        <h2 style={{ fontSize: 15, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 20 }}>
          {state === "done"
            ? "Workspace Ready"
            : state === "error"
              ? "Error"
              : "Creating Workspace..."}
        </h2>

        <ProgressSteps events={events} currentStage={currentStage} />

        {state === "done" && (
          <button
            style={createBtn}
            onClick={() => navigate("/")}
          >
            Go to Dashboard
          </button>
        )}

        {state === "error" && (
          <div style={{ marginTop: 16 }}>
            <div style={{ color: "var(--red)", fontSize: 14, marginBottom: 12 }}>
              {error}
            </div>
            <button
              style={{ ...createBtn, background: "var(--surface-hover)" }}
              onClick={() => { reset(); }}
            >
              Try Again
            </button>
          </div>
        )}
      </div>
    );
  }

  // Template selection + name input form
  const canCreate = selectedTemplate && workspaceName.trim().length > 0;

  return (
    <div className="create-page">
      <button style={backBtn} onClick={() => navigate("/")}>
        ← back
      </button>

      <h2 style={{ fontSize: 15, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 20 }}>
        Create Workspace
      </h2>

      <div style={{ marginBottom: 20 }}>
        <label style={{ display: "block", fontSize: 11, color: "var(--text-dim)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.06em" }}>
          Template
        </label>
        {templatesLoading ? (
          <div style={{ color: "var(--text-dim)", fontSize: 14 }}>Loading templates...</div>
        ) : templates.length === 0 ? (
          <div style={{ color: "var(--text-dim)", fontSize: 14 }}>
            No templates found. Add templates to ~/.config/cx/templates/ or a cx.json in your project.
          </div>
        ) : (
          templates.map((t) => (
            <div
              key={t.name}
              style={selectedTemplate === t.name ? templateCardSelected : templateCard}
              onClick={() => handleSelectTemplate(t.name)}
            >
              <div style={{ fontWeight: 500, fontSize: 13 }}>{t.name}</div>
              <div style={{ color: "var(--text-dim)", fontSize: 12, marginTop: 2 }}>
                {t.coder.template} &middot; {t.type}
                {t.source === "project" && " \u00B7 project"}
              </div>
            </div>
          ))
        )}
      </div>

      <div style={{ marginBottom: 8 }}>
        <label style={{ display: "block", fontSize: 11, color: "var(--text-dim)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.06em" }}>
          Workspace Name
        </label>
        <input
          style={input}
          value={workspaceName}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setWorkspaceName(e.target.value)}
          placeholder="my-workspace"
          autoCapitalize="off"
          autoCorrect="off"
        />
      </div>

      <button
        style={canCreate ? createBtn : createBtnDisabled}
        onClick={handleCreate}
        disabled={!canCreate}
      >
        Create
      </button>
    </div>
  );
}
