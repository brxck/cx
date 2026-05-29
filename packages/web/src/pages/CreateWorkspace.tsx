import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useTemplates } from "../hooks/useTemplates";
import { useUpStream } from "../hooks/useUpStream";
import { ProgressSteps } from "../components/ProgressSteps";
import { fetchTemplateInputs, type TemplateInputField } from "../api";

type FieldValue = string | string[] | boolean | number;

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

const fieldLabel: React.CSSProperties = {
  display: "block",
  fontSize: 11,
  color: "var(--text-dim)",
  marginBottom: 8,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
};

const fieldDesc: React.CSSProperties = {
  fontSize: 11,
  color: "var(--text-dim)",
  marginBottom: 8,
  opacity: 0.8,
};

const textarea: React.CSSProperties = {
  ...input,
  minHeight: 72,
  resize: "vertical",
  lineHeight: 1.5,
};

const chip: React.CSSProperties = {
  padding: "6px 12px",
  borderRadius: "var(--radius)",
  border: "1px solid var(--border)",
  background: "var(--surface)",
  color: "var(--text)",
  fontSize: 13,
  fontFamily: "inherit",
  letterSpacing: "0.02em",
  cursor: "pointer",
};

const chipSelected: React.CSSProperties = {
  ...chip,
  border: "1px solid var(--accent)",
  color: "var(--accent)",
  background: "var(--surface-hover)",
};

function defaultValue(f: TemplateInputField): FieldValue {
  switch (f.kind) {
    case "multiselect":
      return Array.isArray(f.default) ? f.default : [];
    case "confirm":
      return typeof f.default === "boolean" ? f.default : false;
    case "number":
      return typeof f.default === "number" ? f.default : 0;
    case "select":
      return typeof f.default === "string" ? f.default : (f.options?.[0]?.value ?? "");
    default:
      return typeof f.default === "string" ? f.default : "";
  }
}

function serializeValue(v: FieldValue): string {
  if (Array.isArray(v)) return v.join(",");
  if (typeof v === "boolean") return v ? "true" : "false";
  return String(v);
}

export function CreateWorkspace() {
  const navigate = useNavigate();
  const { templates, loading: templatesLoading } = useTemplates();
  const { events, state, error, start, reset } = useUpStream();

  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const [workspaceName, setWorkspaceName] = useState("");
  const [fields, setFields] = useState<TemplateInputField[]>([]);
  const [fieldsLoading, setFieldsLoading] = useState(false);
  const [fieldsError, setFieldsError] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, FieldValue>>({});

  // Load the selected template's declared inputs and seed defaults.
  useEffect(() => {
    if (!selectedTemplate) {
      setFields([]);
      setValues({});
      setFieldsError(null);
      return;
    }
    let cancelled = false;
    setFieldsLoading(true);
    setFieldsError(null);
    fetchTemplateInputs(selectedTemplate)
      .then((res) => {
        if (cancelled) return;
        setFields(res.fields);
        setValues(Object.fromEntries(res.fields.map((f) => [f.name, defaultValue(f)])));
      })
      .catch((err) => {
        if (cancelled) return;
        setFields([]);
        setValues({});
        setFieldsError(err.message ?? "Failed to load template inputs");
      })
      .finally(() => {
        if (!cancelled) setFieldsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedTemplate]);

  const setValue = (name: string, v: FieldValue) => {
    setValues((prev) => ({ ...prev, [name]: v }));
  };

  const toggleMulti = (name: string, option: string) => {
    setValues((prev) => {
      const current = Array.isArray(prev[name]) ? (prev[name] as string[]) : [];
      const next = current.includes(option)
        ? current.filter((o) => o !== option)
        : [...current, option];
      return { ...prev, [name]: next };
    });
  };

  const handleCreate = () => {
    if (!selectedTemplate || !workspaceName.trim()) return;
    const vars: Record<string, string> = {};
    for (const f of fields) {
      vars[f.name] = serializeValue(values[f.name] ?? defaultValue(f));
    }
    start(selectedTemplate, workspaceName.trim(), vars);
  };

  // When selecting a template, pre-fill workspace name
  const handleSelectTemplate = (name: string) => {
    setSelectedTemplate(name);
    if (!workspaceName) {
      setWorkspaceName(name);
    }
  };

  const renderField = (f: TemplateInputField) => {
    const value = values[f.name];
    switch (f.kind) {
      case "multiline":
        return (
          <textarea
            className="input-field"
            style={textarea}
            value={typeof value === "string" ? value : ""}
            onChange={(e) => setValue(f.name, e.target.value)}
            placeholder={f.placeholder ?? f.name}
            autoCapitalize="off"
            autoCorrect="off"
          />
        );
      case "number":
        return (
          <input
            className="input-field"
            style={input}
            type="number"
            value={typeof value === "number" ? value : ""}
            onChange={(e) => setValue(f.name, e.target.value === "" ? 0 : Number(e.target.value))}
            placeholder={f.placeholder ?? f.name}
          />
        );
      case "confirm":
        return (
          <button
            type="button"
            style={value === true ? chipSelected : chip}
            onClick={() => setValue(f.name, value !== true)}
          >
            {value === true ? "yes" : "no"}
          </button>
        );
      case "select":
        return (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {(f.options ?? []).map((o) => (
              <button
                key={o.value}
                type="button"
                style={value === o.value ? chipSelected : chip}
                onClick={() => setValue(f.name, o.value)}
              >
                {o.label}
              </button>
            ))}
          </div>
        );
      case "multiselect": {
        const selected = Array.isArray(value) ? value : [];
        return (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {(f.options ?? []).map((o) => (
              <button
                key={o.value}
                type="button"
                style={selected.includes(o.value) ? chipSelected : chip}
                onClick={() => toggleMulti(f.name, o.value)}
              >
                {o.label}
              </button>
            ))}
          </div>
        );
      }
      default:
        return (
          <input
            className="input-field"
            style={input}
            value={typeof value === "string" ? value : ""}
            onChange={(e) => setValue(f.name, e.target.value)}
            placeholder={f.placeholder ?? f.name}
            autoCapitalize="off"
            autoCorrect="off"
          />
        );
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
            className="btn-accent"
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
              className="btn-accent"
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
      <button className="back-btn" style={backBtn} onClick={() => navigate("/")}>
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
              className="template-card"
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
          className="input-field"
          style={input}
          value={workspaceName}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setWorkspaceName(e.target.value)}
          placeholder="my-workspace"
          autoCapitalize="off"
          autoCorrect="off"
        />
      </div>

      {selectedTemplate && (fieldsLoading || fieldsError || fields.length > 0) && (
        <div style={{ marginTop: 20 }}>
          <label style={fieldLabel}>Parameters</label>
          {fieldsLoading ? (
            <div style={{ color: "var(--text-dim)", fontSize: 14 }}>Loading parameters...</div>
          ) : fieldsError ? (
            <div style={{ color: "var(--red)", fontSize: 13 }}>{fieldsError}</div>
          ) : (
            fields.map((f) => (
              <div key={f.name} style={{ marginBottom: 16 }}>
                <label style={fieldLabel}>{f.name}</label>
                {f.description && <div style={fieldDesc}>{f.description}</div>}
                {renderField(f)}
              </div>
            ))
          )}
        </div>
      )}

      <button
        className="btn-accent"
        style={canCreate ? createBtn : createBtnDisabled}
        onClick={handleCreate}
        disabled={!canCreate}
      >
        Create
      </button>
    </div>
  );
}
