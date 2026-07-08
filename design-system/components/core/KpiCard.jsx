import React from "react";

/** Smoothly counts a figure up on mount/change — the "living ticker" feel. */
function AnimatedNumber({ value, format, duration = 700 }) {
  const [display, setDisplay] = React.useState(0);
  const prev = React.useRef(0);
  React.useEffect(() => {
    const start = prev.current, end = Number(value) || 0;
    if (start === end) { setDisplay(end); return; }
    const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) { setDisplay(end); prev.current = end; return; }
    const t0 = Date.now(); let raf;
    const tick = () => {
      const t = Math.min((Date.now() - t0) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(start + (end - start) * eased);
      if (t < 1) raf = requestAnimationFrame(tick); else prev.current = end;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return <>{format ? format(display) : Math.round(display)}</>;
}

/**
 * KpiCard — a single headline figure with label, optional trend and sparkline
 * slot. The number animates up like an exchange ticker. The workhorse of the
 * dashboard and finance views.
 */
export function KpiCard({
  label,
  value,
  format = (n) => Math.round(n).toLocaleString("ru-RU"),
  unit = "",
  trend = null,        // number — percent delta; sign drives color + arrow
  hint = null,
  icon = null,
  animate = true,
  style = {},
  ...rest
}) {
  const ref = React.useRef(null);
  const onMove = (e) => {
    if (!ref.current) return;
    const r = ref.current.getBoundingClientRect();
    ref.current.style.setProperty("--mx", `${e.clientX - r.left}px`);
    ref.current.style.setProperty("--my", `${e.clientY - r.top}px`);
  };
  const trendUp = trend != null && trend >= 0;
  const trendColor = trend == null ? "var(--text-subtle)" : trendUp ? "var(--success)" : "var(--danger)";

  return (
    <div {...rest} ref={ref} onMouseMove={onMove} className="glass gold-edge" style={{
      position: "relative", borderRadius: "var(--radius-xl)", padding: "16px 18px",
      overflow: "hidden", ...style,
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <span style={{
          fontSize: "var(--fs-micro)", textTransform: "uppercase", letterSpacing: "var(--ls-eyebrow)",
          color: "var(--text-subtle)", fontWeight: 600,
        }}>{label}</span>
        {icon && <span style={{ color: "var(--accent)", opacity: 0.85, display: "inline-flex" }}>{icon}</span>}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
        <span style={{
          fontSize: "var(--fs-2xl)", fontWeight: 600, lineHeight: 1,
          letterSpacing: "var(--ls-display)", color: "var(--text-strong)",
          fontVariantNumeric: "tabular-nums",
        }}>
          {animate ? <AnimatedNumber value={value} format={format} /> : format(Number(value) || 0)}
        </span>
        {unit && <span style={{ fontSize: 15, color: "var(--text-subtle)", fontWeight: 500 }}>{unit}</span>}
      </div>
      {(trend != null || hint) && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10 }}>
          {trend != null && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 12, fontWeight: 600, color: trendColor, fontVariantNumeric: "tabular-nums" }}>
              {trendUp ? "▲" : "▼"} {Math.abs(trend).toFixed(1)}%
            </span>
          )}
          {hint && <span style={{ fontSize: 11.5, color: "var(--text-subtle)" }}>{hint}</span>}
        </div>
      )}
    </div>
  );
}
