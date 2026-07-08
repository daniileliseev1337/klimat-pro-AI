import React from "react";

/**
 * DropdownMenu — an anchored action menu (row "⋯", header account, filters).
 * Pass a `trigger` node and `items` ({ label, icon?, onClick?, danger?, divider? }).
 * Closes on outside-click and Escape. Lightweight; not a full combobox.
 */
export function DropdownMenu({ trigger, items = [], align = "right", width = 200, style = {} }) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef(null);
  React.useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); window.removeEventListener("keydown", onKey); };
  }, [open]);

  return (
    <div ref={ref} style={{ position: "relative", display: "inline-flex", ...style }}>
      <span onClick={() => setOpen((v) => !v)} style={{ display: "inline-flex", cursor: "pointer" }}>{trigger}</span>
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 6px)", [align]: 0, zIndex: "var(--z-dropdown)", width,
          background: "linear-gradient(135deg, rgba(36,36,32,0.97), rgba(22,22,20,0.97))",
          backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)",
          border: "1px solid var(--border-default)", borderRadius: "var(--radius-lg)",
          boxShadow: "var(--shadow-lg)", padding: 5,
          animation: "kp-menu var(--dur-fast) var(--ease-out)",
        }}>
          {items.map((it, i) => it.divider ? (
            <div key={i} style={{ height: 1, background: "var(--border-subtle)", margin: "5px 6px" }} />
          ) : (
            <button key={i} onClick={() => { it.onClick?.(); setOpen(false); }} style={{
              width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "8px 10px",
              borderRadius: "var(--radius-md)", border: "none", background: "transparent", cursor: "pointer",
              textAlign: "left", fontSize: 13.5, fontFamily: "var(--font-sans)",
              color: it.danger ? "var(--danger)" : "var(--text-body)", transition: "background var(--dur-fast)",
            }}
              onMouseEnter={(e) => e.currentTarget.style.background = it.danger ? "var(--danger-fill)" : "var(--w-06)"}
              onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}>
              {it.icon && <span style={{ display: "inline-flex", color: it.danger ? "var(--danger)" : "var(--text-subtle)" }}>{it.icon}</span>}
              <span style={{ flex: 1 }}>{it.label}</span>
              {it.hint && <span style={{ fontSize: 11, color: "var(--text-subtle)", fontFamily: "var(--font-mono)" }}>{it.hint}</span>}
            </button>
          ))}
          <style>{`@keyframes kp-menu{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}`}</style>
        </div>
      )}
    </div>
  );
}
