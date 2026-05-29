import { useState, useRef, useEffect } from "react";

export interface MenuItem {
  label: string;
  icon?: React.ReactNode;
  color?: string;
  href?: string;
  onClick?: () => void;
  disabled?: boolean;
}

const triggerBtn: React.CSSProperties = {
  width: 32,
  height: 32,
  borderRadius: "var(--radius)",
  border: "none",
  background: "transparent",
  color: "var(--accent)",
  fontSize: 15,
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
};

const menuStyle: React.CSSProperties = {
  position: "absolute",
  top: "calc(100% + 4px)",
  right: 0,
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius)",
  padding: 4,
  zIndex: 10,
  minWidth: 150,
  boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
};

const itemStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  width: "100%",
  padding: "8px 12px",
  fontSize: 12,
  fontWeight: 500,
  background: "none",
  border: "none",
  borderRadius: "var(--radius)",
  cursor: "pointer",
  textAlign: "left",
  whiteSpace: "nowrap",
  textDecoration: "none",
};

export function IconMenu({ icon, items, title, color }: { icon: React.ReactNode; items: MenuItem[]; title?: string; color?: string }) {
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

  if (items.length === 0) return null;

  return (
    <div ref={ref} style={{ position: "relative", display: "inline-block" }}>
      <button className="icon-btn" style={{ ...triggerBtn, ...(color ? { color } : {}) }} onClick={() => setOpen(!open)} title={title}>
        {icon}
      </button>
      {open && (
        <div style={menuStyle}>
          {items.map((item, i) =>
            item.href ? (
              <a
                key={i}
                className="menu-item"
                href={item.href}
                target="_blank"
                rel="noopener"
                style={{ ...itemStyle, color: item.color ?? "var(--accent)" }}
                onClick={() => setOpen(false)}
              >
                {item.icon}{item.label}
              </a>
            ) : (
              <button
                key={i}
                className="menu-item"
                disabled={item.disabled}
                style={{
                  ...itemStyle,
                  color: item.color ?? "var(--text)",
                  opacity: item.disabled ? 0.5 : 1,
                }}
                onClick={() => {
                  setOpen(false);
                  item.onClick?.();
                }}
              >
                {item.icon}{item.label}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}
