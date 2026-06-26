import { useState, useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";

// Командная палитра (Ctrl/Cmd+K): быстрый поиск/переход по разделам, проектам, задачам, заказам.
const SECTIONS = [
  { id: "dashboard", label: "Дашборд" },
  { id: "projects",  label: "Проекты" },
  { id: "tasks",     label: "Задачи" },
  { id: "finance",   label: "Финансы" },
  { id: "analytics", label: "Аналитика" },
  { id: "clients",   label: "Заказчики" },
  { id: "myorders",  label: "Мои заказы" },
];

export default function CommandPalette({ open, onClose, projects = [], tasks = [], orders = [], hasClientRole = false, allowedTabs = null, restricted = false, onNavigate }) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef(null);

  useEffect(() => {
    if (open) { setQ(""); setSel(0); setTimeout(() => inputRef.current?.focus(), 30); }
  }, [open]);

  const items = useMemo(() => {
    const ql = q.trim().toLowerCase();
    const out = [];
    SECTIONS
      .filter(s => !allowedTabs || allowedTabs.includes(s.id))
      .filter(s => s.id !== "myorders" || hasClientRole)
      .filter(s => !ql || s.label.toLowerCase().includes(ql))
      .forEach(s => out.push({ kind: "section", id: s.id, label: s.label, hint: "Раздел" }));
    if (ql) {
      if (!restricted) {
        projects.filter(p => (p.name || "").toLowerCase().includes(ql)).slice(0, 6)
          .forEach(p => out.push({ kind: "project", id: p.id, label: p.name, hint: "Проект" }));
        tasks.filter(t => (t.title || "").toLowerCase().includes(ql)).slice(0, 6)
          .forEach(t => out.push({ kind: "task", id: t.id, label: t.title, hint: "Задача" }));
      }
      orders.filter(o => (o.name || "").toLowerCase().includes(ql)).slice(0, 6)
        .forEach(o => out.push({ kind: "order", id: o.id, label: o.name, hint: "Заказ" }));
    }
    return out;
  }, [q, projects, tasks, orders, hasClientRole, allowedTabs, restricted]);

  useEffect(() => { if (sel >= items.length && items.length) setSel(0); }, [items.length, sel]);

  if (!open) return null;

  const choose = (it) => { if (it) onNavigate?.(it); onClose?.(); };
  const onKey = (e) => {
    if (e.key === "Escape") onClose?.();
    else if (e.key === "ArrowDown") { e.preventDefault(); setSel(s => Math.min(s + 1, items.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSel(s => Math.max(s - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); choose(items[sel]); }
  };

  return createPortal(
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, zIndex: 300, background: "rgba(0,0,0,0.55)",
      backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)",
      display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: "12vh",
    }}>
      <div onClick={e => e.stopPropagation()} onKeyDown={onKey} style={{
        width: "min(92vw, 560px)", background: "rgba(20,20,22,0.97)", borderRadius: 16,
        border: "1px solid var(--border-gold-subtle)",
        boxShadow: "0 30px 80px rgba(0,0,0,0.6), 0 0 40px -10px var(--gold-glow)", overflow: "hidden",
      }}>
        <input ref={inputRef} value={q} onChange={e => { setQ(e.target.value); setSel(0); }}
          placeholder="Поиск: проект, задача, заказ, раздел…" style={{
            width: "100%", padding: "16px 18px", background: "transparent", border: "none",
            borderBottom: "1px solid rgba(255,255,255,0.08)", color: "#fafaf7", fontSize: 15,
            outline: "none", fontFamily: "inherit", boxSizing: "border-box",
          }} />
        <div style={{ maxHeight: "50vh", overflowY: "auto", padding: 6 }}>
          {items.length === 0 ? (
            <div style={{ padding: 18, color: "#6b6b67", fontSize: 13, textAlign: "center" }}>Ничего не найдено</div>
          ) : items.map((it, i) => (
            <div key={it.kind + it.id} onMouseEnter={() => setSel(i)} onClick={() => choose(it)} style={{
              display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10,
              padding: "10px 12px", borderRadius: 10, cursor: "pointer",
              background: i === sel ? "var(--gold-bg)" : "transparent",
              color: i === sel ? "#fafaf7" : "#cfcfca",
            }}>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.label}</span>
              <span style={{ fontSize: 11, color: "#6b6b67", flexShrink: 0 }}>{it.hint}</span>
            </div>
          ))}
        </div>
        <div style={{ padding: "8px 14px", borderTop: "1px solid rgba(255,255,255,0.06)",
          fontSize: 11, color: "#6b6b67", display: "flex", gap: 14, flexWrap: "wrap" }}>
          <span>↑↓ выбрать</span><span>↵ перейти</span><span>Esc закрыть</span>
        </div>
      </div>
    </div>,
    document.body
  );
}
