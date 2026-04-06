import { useState, useRef, useEffect } from "react";

export interface Action {
  label: string;
  color?: string;
  onClick: () => void;
  disabled?: boolean;
}

const pillBtn: React.CSSProperties = {
  padding: "6px 12px",
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--surface-hover)",
  color: "var(--text-dim)",
  fontSize: 13,
  fontWeight: 500,
  cursor: "pointer",
  position: "relative",
};

const menu: React.CSSProperties = {
  position: "absolute",
  bottom: "calc(100% + 4px)",
  right: 0,
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: 4,
  zIndex: 10,
  minWidth: 140,
  boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
};

const menuItem: React.CSSProperties = {
  display: "block",
  width: "100%",
  padding: "8px 12px",
  fontSize: 13,
  background: "none",
  border: "none",
  borderRadius: 6,
  cursor: "pointer",
  textAlign: "left",
  whiteSpace: "nowrap",
};

export function ActionMenu({ actions }: { actions: Action[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  if (actions.length === 0) return null;

  return (
    <div ref={ref} style={{ position: "relative", display: "inline-block" }}>
      <button style={pillBtn} onClick={() => setOpen(!open)}>
        Actions
      </button>
      {open && (
        <div style={menu}>
          {actions.map((action, i) => (
            <button
              key={i}
              disabled={action.disabled}
              style={{
                ...menuItem,
                color: action.color ?? "var(--text)",
                opacity: action.disabled ? 0.5 : 1,
              }}
              onClick={() => {
                setOpen(false);
                action.onClick();
              }}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
