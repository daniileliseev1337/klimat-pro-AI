import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { Compass, X } from "lucide-react";

// Онбординг-тур: слайд-тур по разделам. sections — готовый роль-фильтрованный массив (фильтрацию
// делает App через helpSectionsFor). Показывает по одной секции, листание кнопками/стрелками.
export default function TourModal({ sections = [], onClose }) {
  const [idx, setIdx] = useState(0);

  // пустой тур не показываем — сразу закрыть
  useEffect(() => { if (!sections.length) onClose?.(); }, [sections.length, onClose]);

  // клавиатура: ← → листают, Esc закрывает
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose?.();
      else if (e.key === "ArrowRight") setIdx((i) => Math.min(i + 1, sections.length - 1));
      else if (e.key === "ArrowLeft") setIdx((i) => Math.max(i - 1, 0));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sections.length, onClose]);

  if (!sections.length) return null;
  const i = Math.min(idx, sections.length - 1);
  const s = sections[i];
  const last = i >= sections.length - 1;
  const btn = (bg, color, border) => ({
    padding: "8px 16px", borderRadius: 9, cursor: "pointer", fontSize: 13, fontWeight: 600,
    background: bg, color, border: border || "none",
  });

  return createPortal(
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, zIndex: 210, background: "rgba(8,9,15,0.82)",
      backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: "#1c1c1a", border: "1px solid var(--border-gold-subtle)", borderRadius: 18,
        width: "100%", maxWidth: "min(100vw - 32px, 480px)",
        boxShadow: "0 30px 80px rgba(0,0,0,0.6), 0 0 40px -10px var(--gold-glow)", overflow: "hidden",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "16px 18px",
          borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
          <Compass size={20} color="var(--gold, #d4af37)" />
          <span style={{ fontSize: 15, fontWeight: 600, color: "#fafaf7", flex: 1 }}>Экскурсия по разделам</span>
          <button onClick={onClose} aria-label="Пропустить"
            style={{ background: "none", border: "none", cursor: "pointer", color: "#9a9a95", padding: 4 }}>
            <X size={18} />
          </button>
        </div>
        <div style={{ padding: "20px 18px", minHeight: 120 }}>
          <div style={{ fontSize: 17, fontWeight: 600, color: "#fafaf7", marginBottom: 8 }}>{s.title}</div>
          <div style={{ fontSize: 14, color: "#cfcfca", lineHeight: 1.55, marginBottom: 10 }}>{s.desc}</div>
          <div style={{ fontSize: 12, color: "#8a8a85" }}>{s.how}</div>
        </div>
        <div style={{ display: "flex", justifyContent: "center", gap: 6, padding: "4px 0 10px" }}>
          {sections.map((sec, k) => (
            <span key={sec.key} style={{ width: 6, height: 6, borderRadius: "50%",
              background: k === i ? "var(--gold, #d4af37)" : "rgba(255,255,255,0.18)" }} />
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 16px",
          borderTop: "1px solid rgba(255,255,255,0.06)" }}>
          <button onClick={() => setIdx((x) => Math.max(x - 1, 0))} disabled={i === 0}
            style={{ ...btn("rgba(255,255,255,0.06)", i === 0 ? "#55554f" : "#cfcfca"), cursor: i === 0 ? "default" : "pointer" }}>
            Назад
          </button>
          <span style={{ fontSize: 12, color: "#6b6b67" }}>{i + 1} из {sections.length}</span>
          <span style={{ flex: 1 }} />
          <button onClick={onClose} style={btn("transparent", "#8a8a85", "1px solid rgba(255,255,255,0.12)")}>Пропустить</button>
          {last
            ? <button onClick={onClose} style={btn("var(--gold, #d4af37)", "#1a1a17")}>Готово</button>
            : <button onClick={() => setIdx((x) => Math.min(x + 1, sections.length - 1))} style={btn("var(--gold, #d4af37)", "#1a1a17")}>Далее</button>}
        </div>
      </div>
    </div>,
    document.body
  );
}
