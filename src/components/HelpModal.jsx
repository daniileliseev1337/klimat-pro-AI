import { createPortal } from "react-dom";
import { HelpCircle, X } from "lucide-react";

// Раздел «Помощь / Возможности»: список доступных пользователю разделов с описанием и «как открыть».
// Фильтрацию секций по роли делает App (передаёт готовый sections) — здесь только отрисовка.
export default function HelpModal({ sections = [], onClose }) {
  return createPortal(
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, zIndex: 200, background: "rgba(8,9,15,0.80)",
      backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: "#1c1c1a", border: "1px solid var(--border-gold-subtle)", borderRadius: 18,
        width: "100%", maxWidth: "min(100vw - 32px, 560px)", maxHeight: "88vh",
        display: "flex", flexDirection: "column", overflow: "hidden",
        boxShadow: "0 30px 80px rgba(0,0,0,0.6), 0 0 40px -10px var(--gold-glow)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "16px 18px",
          borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
          <HelpCircle size={20} color="var(--gold, #d4af37)" />
          <span style={{ fontSize: 16, fontWeight: 600, color: "#fafaf7", flex: 1 }}>Возможности и помощь</span>
          <button onClick={onClose} aria-label="Закрыть"
            style={{ background: "none", border: "none", cursor: "pointer", color: "#9a9a95", padding: 4 }}>
            <X size={18} />
          </button>
        </div>
        <div style={{ overflowY: "auto", padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
          {sections.map((s) => (
            <div key={s.key} style={{ padding: "12px 14px", borderRadius: 12,
              background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#fafaf7", marginBottom: 4 }}>{s.title}</div>
              <div style={{ fontSize: 13, color: "#cfcfca", lineHeight: 1.5, marginBottom: 6 }}>{s.desc}</div>
              <div style={{ fontSize: 12, color: "#8a8a85" }}>{s.how}</div>
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body
  );
}
