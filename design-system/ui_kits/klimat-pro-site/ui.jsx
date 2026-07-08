/* ui.jsx — КЛИМАТ-ПРО UI primitives on the NEW liquid glass.
   LogoMark (rotating A·B·C·F·L), Glass material component, KpiCard, Card,
   SectionTitle, Chip, lucide-style icons, and lightweight charts.
   All attached to window for the babel scripts. */
const { useState, useEffect, useRef } = React;

/* ── formatting ── */
const fmt  = n => new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 }).format(+n || 0);
const fmtD = d => d ? new Date(d + "T00:00:00").toLocaleDateString("ru-RU", { day: "numeric", month: "short" }) : "—";

/* ── lucide-style icon factory (stroke, 24 viewBox) ── */
const mk = (paths, fill) => ({ size = 16, strokeWidth = 2, color = "currentColor", style } = {}) =>
  React.createElement("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: fill || "none", stroke: color, strokeWidth, strokeLinecap: "round", strokeLinejoin: "round", style },
    paths.map((d, i) => React.createElement("path", { key: i, d })));
const Icon = {
  dashboard: mk(["M3 3h8v8H3zM13 3h8v5h-8zM13 12h8v9h-8zM3 15h8v6H3z"]),
  projects:  mk(["M4 4h6l2 2h8v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z", "M2 10h20"]),
  tasks:     mk(["M9 6h11M9 12h11M9 18h11", "M4.5 5.5l1 1 2-2M4.5 11.5l1 1 2-2M4.5 17.5l1 1 2-2"]),
  wallet:    mk(["M3 7a2 2 0 0 1 2-2h14v4M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-4M3 7h16", "M17 13h.01"]),
  analytics: mk(["M3 3v18h18", "M7 14l3-4 3 3 4-6"]),
  briefcase: mk(["M4 7h16v13H4zM9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2", "M4 12h16"]),
  badge:     mk(["M12 2l2.5 2 3.5-.5.5 3.5L21 12l-2 3 .5 3.5-3.5.5L12 22l-2.5-2.5L6 20l-.5-3.5L3 12l2-3-.5-3.5L8 4z", "M9 12l2 2 4-4"]),
  alert:     mk(["M12 3l9 16H3z", "M12 10v4", "M12 17h.01"]),
  up:        mk(["M4 17l6-6 4 4 6-7", "M20 8v5h-5"]),
  down:      mk(["M4 7l6 6 4-4 6 7", "M20 16v-5h-5"]),
  calendar:  mk(["M4 5h16v16H4zM4 9h16M8 3v4M16 3v4"]),
  file:      mk(["M6 2h8l4 4v16H6zM14 2v4h4"]),
  package:   mk(["M12 2l9 4.5v11L12 22 3 17.5v-11z", "M3 7l9 4 9-4M12 11v11"]),
  bell:      mk(["M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6", "M10 20a2 2 0 0 0 4 0"]),
  search:    mk(["M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-3.2-3.2"]),
  logout:    mk(["M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4", "M16 17l5-5-5-5", "M21 12H9"]),
  trend:     mk(["M3 3v18h18", "M7 13l3-3 3 2 4-5"]),
  wind:      mk(["M3 8h9a3 3 0 1 0-3-3", "M3 12h13a3 3 0 1 1-3 3", "M3 16h6"]),
};

/* ── LogoMark: 5 rotating climate glyphs, gold gradient stroke ── */
const LOGO_ORDER = ["A", "B", "C", "F", "L"];
function LogoMark() {
  const G = { fill: "none", stroke: "url(#kpg)", strokeWidth: 1.7, strokeLinecap: "round", strokeLinejoin: "round" };
  const ICONS = {
    A: <svg width="22" height="22" viewBox="0 0 24 24" {...G}><g className="kpl-flow"><path d="M3 12a4 4 0 0 1 4-4h9a3 3 0 1 0-3-3" /><path d="M3 17h13a3 3 0 1 1-3 3" /><path d="M3 7h4" /></g></svg>,
    B: <svg width="22" height="22" viewBox="0 0 24 24" {...G}><g className="kpl-spin"><path d="M10.827 16.379a6.082 6.082 0 0 1-8.618-7.002l5.412 1.45a6.082 6.082 0 0 1 7.002-8.618l-1.45 5.412a6.082 6.082 0 0 1 8.618 7.002l-5.412-1.45a6.082 6.082 0 0 1-7.002 8.618z" /></g><circle cx="12" cy="12" r="1.4" fill="url(#kpg)" stroke="none" /></svg>,
    C: <svg width="22" height="22" viewBox="0 0 24 24" {...G}><g className="kpl-cold"><path d="M12 2v20M2 12h20M4.9 4.9l14.2 14.2M19.1 4.9L4.9 19.1" /></g><g className="kpl-warm"><circle cx="12" cy="12" r="3.6" /><path d="M12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21M5.6 5.6l1.6 1.6M16.8 16.8l1.6 1.6M18.4 5.6l-1.6 1.6M7.2 16.8l-1.6 1.6" /></g></svg>,
    F: <svg width="22" height="22" viewBox="0 0 24 24" {...G}><path d="M4 11l8-6 8 6v8a1 1 0 0 1-1 1h-4v-5h-6v5H5a1 1 0 0 1-1-1z" /><path className="kpl-flow" d="M7 12h6a1.6 1.6 0 1 0-1.6-1.6" /></svg>,
    L: <svg width="22" height="22" viewBox="0 0 24 24" {...G}><path d="M4 11l8-6 8 6v8a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z" /><path className="kpl-beat" d="M12 17.6s-3-2-3-4.1A1.6 1.6 0 0 1 12 12.1 1.6 1.6 0 0 1 15 13.5c0 2.1-3 4.1-3 4.1z" fill="url(#kpg)" stroke="none" /></svg>,
  };
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = setInterval(() => setIdx(i => (i + 1) % LOGO_ORDER.length), 6000);
    return () => clearInterval(t);
  }, []);
  return (
    <div style={{ position: "relative", width: 22, height: 22 }}>
      <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true"><defs>
        <linearGradient id="kpg" x1="0" y1="0" x2="24" y2="24"><stop offset="0" stopColor="#f6e7a8" /><stop offset="0.6" stopColor="#d4af37" /><stop offset="1" stopColor="#9c7c22" /></linearGradient>
      </defs></svg>
      {LOGO_ORDER.map((id, i) => (
        <div key={id} style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", opacity: i === idx ? 1 : 0, transition: "opacity 1.4s ease-in-out" }}>{ICONS[id]}</div>
      ))}
    </div>
  );
}

/* ── Glass: the NEW liquid-glass material (refraction + gold edge + spotlight) ── */
function Glass({ children, gold = false, tint, r = 14, blur = 6, band = 14, padding = 18, hover = true, className = "", style = {}, bodyStyle = {}, ...rest }) {
  const ref = useRef(null);
  const onMove = e => {
    const el = ref.current; if (!el) return;
    const b = el.getBoundingClientRect();
    el.style.setProperty("--mx", (e.clientX - b.left) + "px");
    el.style.setProperty("--my", (e.clientY - b.top) + "px");
    rest.onMouseMove && rest.onMouseMove(e);
  };
  const cls = ["lg", gold ? "lg--gold" : "", tint === "gold" ? "lg--gold-tint" : "", className].filter(Boolean).join(" ");
  return (
    <div ref={ref} {...rest} onMouseMove={onMove} className={cls}
      style={{ "--r": r + "px", "--blur": blur + "px", "--band": band + "px", padding, ...style }}>
      <span className="lg-lens" aria-hidden />
      <span className="lg-shine" aria-hidden />
      <span className="lg-spot" aria-hidden />
      <div className="lg-body" style={bodyStyle}>{children}</div>
    </div>
  );
}

/* ── AnimatedNumber: count-up like a stock ticker ── */
function AnimatedNumber({ value, format }) {
  const [d, setD] = useState(0);
  const prev = useRef(0);
  useEffect(() => {
    const from = prev.current, to = +value || 0, t0 = performance.now(), dur = 700;
    let raf;
    const step = (t) => {
      const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
      setD(from + (to - from) * e);
      if (k < 1) raf = requestAnimationFrame(step); else prev.current = to;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <span>{format ? format(Math.round(d)) : Math.round(d).toLocaleString("ru-RU")}</span>;
}

/* ── KpiCard ── */
function KpiCard({ label, value, sub, color = "#d4af37", icon, format, trend, gold = true }) {
  const isString = typeof value === "string";
  return (
    <Glass gold={gold} padding={16} style={{ overflow: "hidden" }}>
      <div aria-hidden style={{ position: "absolute", top: -30, right: -30, width: 90, height: 90, background: `radial-gradient(circle, ${color}22 0%, transparent 70%)`, pointerEvents: "none" }} />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", position: "relative" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: 11, fontWeight: 600, color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.08em" }}>{label}</p>
          <div style={{ fontSize: 18, fontWeight: 700, color: "#f7f8f8", marginTop: 6, lineHeight: 1.15, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums" }}>
            {isString ? value : <AnimatedNumber value={value} format={format} />}
          </div>
          {sub && (
            <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: 6, display: "flex", alignItems: "center", gap: 4 }}>
              {trend === "up" && Icon.up({ size: 11, color: "#6ee7a8" })}
              {trend === "down" && Icon.down({ size: 11, color: "#f8a3a3" })}
              <span>{sub}</span>
            </div>
          )}
        </div>
        {icon && <div style={{ background: `${color}1a`, border: `1px solid ${color}33`, padding: 8, borderRadius: 9, display: "flex", color, flexShrink: 0 }}>{icon({ size: 16, strokeWidth: 2 })}</div>}
      </div>
    </Glass>
  );
}

function Card(props) { return <Glass padding={18} gold {...props} />; }

function SectionTitle({ children, icon }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
      {icon && <span style={{ color: "var(--text-tertiary)", display: "flex" }}>{icon}</span>}
      <p style={{ fontSize: 11, fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.10em", margin: 0 }}>{children}</p>
    </div>
  );
}

function Chip({ label, active, onClick }) {
  return (
    <button onClick={onClick} style={{
      padding: "6px 13px", borderRadius: 999, cursor: "pointer", fontFamily: "inherit", fontSize: 12.5, fontWeight: active ? 600 : 500,
      border: "1px solid", borderColor: active ? "var(--border-gold)" : "var(--border-subtle)",
      background: active ? "var(--gold-bg)" : "rgba(255,255,255,0.03)", color: active ? "var(--gold-bright)" : "var(--text-secondary)",
      transition: "all .18s",
    }}>{label}</button>
  );
}

/* ── charts (lightweight SVG, faithful to recharts look) ── */
function BarsChart({ data, height = 210 }) {
  const w = 460, pad = 26, max = Math.max(...data.flatMap(d => [d.inc, d.exp]), 1);
  const bw = 13, gap = 5, groupW = (w - pad) / data.length;
  const y = v => (height - 22) - (v / max) * (height - 42);
  return (
    <svg width="100%" viewBox={`0 0 ${w} ${height}`} style={{ display: "block" }}>
      {[0.25, 0.5, 0.75, 1].map((f, i) => <line key={i} x1={pad} x2={w} y1={y(max * f)} y2={y(max * f)} stroke="rgba(255,255,255,0.05)" />)}
      {data.map((d, i) => {
        const cx = pad + i * groupW + groupW / 2;
        return (
          <g key={i}>
            <rect x={cx - bw - gap / 2} y={y(d.inc)} width={bw} height={(height - 22) - y(d.inc)} rx={4} fill="#d4af37" />
            <rect x={cx + gap / 2} y={y(d.exp)} width={bw} height={(height - 22) - y(d.exp)} rx={4} fill="#f8a3a3" />
            <text x={cx} y={height - 6} textAnchor="middle" fontSize="10" fill="#62646b">{d.label}</text>
          </g>
        );
      })}
    </svg>
  );
}

function Donut({ data, size = 168 }) {
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  const R = size / 2, r = R * 0.62, cx = R, cy = R;
  let acc = -Math.PI / 2;
  const arcs = data.map(d => {
    const frac = d.value / total, a0 = acc, a1 = acc + frac * 2 * Math.PI; acc = a1;
    const large = frac > 0.5 ? 1 : 0;
    const p = (ang, rad) => [cx + Math.cos(ang) * rad, cy + Math.sin(ang) * rad];
    const [x0, y0] = p(a0, R), [x1, y1] = p(a1, R), [x2, y2] = p(a1, r), [x3, y3] = p(a0, r);
    return { d: `M${x0} ${y0} A${R} ${R} 0 ${large} 1 ${x1} ${y1} L${x2} ${y2} A${r} ${r} 0 ${large} 0 ${x3} ${y3} Z`, fill: d.fill };
  });
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
      <svg width={size} height={size} style={{ flexShrink: 0 }}>{arcs.map((a, i) => <path key={i} d={a.d} fill={a.fill} stroke="rgba(10,10,10,0.6)" strokeWidth="1.5" />)}</svg>
      <div style={{ display: "flex", flexDirection: "column", gap: 7, minWidth: 120 }}>
        {data.map((d, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
            <span style={{ width: 9, height: 9, borderRadius: 3, background: d.fill, flexShrink: 0 }} />
            <span style={{ color: "var(--text-secondary)", flex: 1 }}>{d.name}</span>
            <span style={{ color: "var(--text-tertiary)", fontVariantNumeric: "tabular-nums" }}>{Math.round(d.value / total * 100)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function AreaLine({ series, height = 210 }) {
  const w = 460, pad = 26, vals = series.map(s => s.bal);
  const max = Math.max(...vals, 1), min = Math.min(...vals, 0);
  const x = i => pad + (i / (series.length - 1)) * (w - pad - 8);
  const y = v => (height - 22) - ((v - min) / (max - min || 1)) * (height - 42);
  const line = series.map((s, i) => `${x(i)},${y(s.bal)}`).join(" ");
  const area = `${pad},${height - 22} ${line} ${x(series.length - 1)},${height - 22}`;
  return (
    <svg width="100%" viewBox={`0 0 ${w} ${height}`} style={{ display: "block" }}>
      <defs><linearGradient id="cf" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="rgba(110,231,168,0.28)" /><stop offset="1" stopColor="rgba(110,231,168,0)" /></linearGradient></defs>
      {[0.5, 1].map((f, i) => <line key={i} x1={pad} x2={w} y1={y(min + (max - min) * f)} y2={y(min + (max - min) * f)} stroke="rgba(255,255,255,0.05)" />)}
      <polygon points={area} fill="url(#cf)" />
      <polyline points={line} fill="none" stroke="#6ee7a8" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      {series.map((s, i) => <text key={i} x={x(i)} y={height - 6} textAnchor="middle" fontSize="10" fill="#62646b">{s.label}</text>)}
    </svg>
  );
}

Object.assign(window, { fmt, fmtD, Icon, LogoMark, Glass, AnimatedNumber, KpiCard, Card, SectionTitle, Chip, BarsChart, Donut, AreaLine });
