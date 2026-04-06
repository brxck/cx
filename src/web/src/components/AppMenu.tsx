import { useState, useRef, useEffect } from "react";
import type { AppEntry } from "../api";

const pillBtn: React.CSSProperties = {
  padding: "6px 12px",
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--surface-hover)",
  color: "var(--accent)",
  fontSize: 13,
  fontWeight: 500,
  cursor: "pointer",
  position: "relative",
};

const menu: React.CSSProperties = {
  position: "absolute",
  top: "calc(100% + 4px)",
  left: 0,
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
  padding: "8px 12px",
  fontSize: 13,
  color: "var(--accent)",
  textDecoration: "none",
  borderRadius: 6,
};

export function AppMenu({ apps, dashboardUrl }: { apps: AppEntry[]; dashboardUrl: string }) {
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

  if (apps.length === 0) return null;

  return (
    <div ref={ref} style={{ position: "relative", display: "inline-block" }}>
      <button style={pillBtn} onClick={() => setOpen(!open)}>
        Apps ({apps.length})
      </button>
      {open && (
        <div style={menu}>
          {apps.map((app) => (
            <a
              key={app.slug}
              href={`${dashboardUrl}/apps/${app.slug}`}
              target="_blank"
              rel="noopener"
              style={menuItem}
              onClick={() => setOpen(false)}
            >
              {app.label}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
