import React from "react";

/**
 * Badge — compact status pill. Use `tone` for semantic signals or pass an
 * explicit `color` (e.g. a project-stage hex). `dot` adds a leading status dot.
 */
export function Badge({ children, tone = "neutral", color = null, dot = false, size = "md", style = {}, ...rest }) {
  const tones = {
    neutral: { fg: "var(--text-muted)", bg: "var(--w-06)", bd: "var(--border-default)" },
    gold:    { fg: "var(--accent-hover)", bg: "var(--accent-fill)", bd: "var(--border-gold-subtle)" },
    success: { fg: "var(--success)", bg: "var(--success-fill)", bd: "var(--success-border)" },
    warning: { fg: "var(--warning)", bg: "var(--warning-fill)", bd: "var(--warning-border)" },
    danger:  { fg: "var(--danger)", bg: "var(--danger-fill)", bd: "var(--danger-border)" },
    info:    { fg: "var(--info)", bg: "var(--info-fill)", bd: "var(--info-border)" },
  };
  const t = color
    ? { fg: color, bg: `${color}1a`, bd: `${color}40` }
    : (tones[tone] || tones.neutral);
  const sz = size === "sm"
    ? { padding: "2px 7px", fontSize: 10.5, gap: 5, dot: 5 }
    : { padding: "3px 9px", fontSize: 11.5, gap: 6, dot: 6 };

  return (
    <span {...rest} style={{
      display: "inline-flex", alignItems: "center", gap: sz.gap,
      padding: sz.padding, fontSize: sz.fontSize, fontWeight: 600,
      lineHeight: 1, letterSpacing: "0.005em", whiteSpace: "nowrap",
      color: t.fg, background: t.bg,
      border: `1px solid ${t.bd}`, borderRadius: "var(--radius-pill)",
      ...style,
    }}>
      {dot && <span style={{ width: sz.dot, height: sz.dot, borderRadius: "50%", background: t.fg, flexShrink: 0 }} />}
      {children}
    </span>
  );
}
