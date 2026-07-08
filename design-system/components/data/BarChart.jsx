import React from "react";

/**
 * BarChart — compact categorical bars (monthly revenue, expense categories).
 * Gold gradient bars by default; pass per-datum `color` for category breakdowns.
 * data: [{ label, value, color? }]. Values labelled on hover.
 */
export function BarChart({ data = [], height = 200, gap = 14, format = (n) => n, style = {} }) {
  const max = Math.max(...data.map((d) => d.value)) * 1.1 || 1;
  const [hover, setHover] = React.useState(-1);
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap, height, ...style }}>
      {data.map((d, i) => {
        const h = (d.value / max) * 100;
        const c = d.color || "var(--accent)";
        return (
          <div key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(-1)}
            style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", height: "100%", cursor: "default" }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: hover === i ? "var(--text-strong)" : "var(--text-subtle)", marginBottom: 6, fontVariantNumeric: "tabular-nums", transition: "color var(--dur-fast)", opacity: hover === i ? 1 : 0.85 }}>
              {format(d.value)}
            </span>
            <div style={{
              width: "100%", maxWidth: 46, height: `${h}%`, borderRadius: "6px 6px 2px 2px",
              background: d.color ? c : "linear-gradient(180deg, var(--gold-400), var(--gold-600))",
              boxShadow: hover === i ? "0 0 18px -4px var(--accent-glow)" : "none",
              transition: "box-shadow var(--dur-fast), filter var(--dur-fast)",
              filter: hover === i ? "brightness(1.12)" : "none",
            }} />
            <span style={{ fontSize: 10.5, color: "var(--text-subtle)", marginTop: 8, fontFamily: "var(--font-mono)" }}>{d.label}</span>
          </div>
        );
      })}
    </div>
  );
}
