/* ============================================================================
   glass.jsx — Liquid Glass engine + lab controls (Klimat Pro)
   The var-driven <LiquidGlass> surface + the slider/toggle/segmented controls
   used by the lab. No ES exports — everything is attached to window at the end
   (loaded via <script type="text/babel">). Styling lives in inline styles +
   the .lg* CSS in the page shell (both driven by CSS custom properties).
   ========================================================================== */

const { useRef, useState, useEffect } = React;

/* Preset material tiers. Each maps to a pair of SVG displacement filters
   (#warp-<key> / #rim-<key>) plus its frost/clarity numbers. */
const GLASS_PRESETS = {
  sheer:   { label: "Sheer",   ru: "Тонкое",   blur: 3,  sat: 1.5,  bri: 1.0,  band: 10, r: 22, key: "sheer",   note: "Лёгкое · навигация, чипы" },
  frost:   { label: "Frost",   ru: "Матовое",  blur: 14, sat: 1.4,  bri: 0.94, band: 16, r: 24, key: "frost",   note: "Плотное · модалки, оверлеи" },
  gel:     { label: "Gel",     ru: "Гелевое",  blur: 6,  sat: 1.75, bri: 1.0,  band: 16, r: 28, key: "gel",     note: "Сочное · hero-поверхности" },
  crystal: { label: "Crystal", ru: "Кристалл", blur: 2,  sat: 1.95, bri: 1.05, band: 14, r: 26, key: "crystal", note: "Прозрачное · premium-карточки" },
};

/* Mutate a live SVG displacement filter's strength (for the playground). */
function setFilterScale(filterId, scale) {
  const f = document.getElementById(filterId);
  if (!f) return;
  const dm = f.querySelector("feDisplacementMap");
  if (dm) dm.setAttribute("scale", scale);
}

const LG_MASK = {
  WebkitMask: "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)",
  WebkitMaskComposite: "xor",
  maskComposite: "exclude",
};

/* The material. `cfg` = resolved recipe {blur,sat,bri,band,r,key}. `gold` =
   'none' | 'edge' | 'tint'. `motion` = {blik,parallax,morph}. */
function LiquidGlass({ cfg, gold = "none", motion = {}, live = false, interactive = true, style = {}, bodyStyle = {}, className = "", children, ...rest }) {
  const ref = useRef(null);

  const onMove = (e) => {
    const el = ref.current; if (!el || !interactive) return;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width;
    const py = (e.clientY - r.top) / r.height;
    el.style.setProperty("--mx", px * 100 + "%");
    el.style.setProperty("--my", py * 100 + "%");
    if (motion.parallax) {
      el.style.setProperty("--px", (px - 0.5).toFixed(3));
      el.style.setProperty("--py", (py - 0.5).toFixed(3));
    }
    rest.onMouseMove?.(e);
  };
  const onLeave = (e) => {
    const el = ref.current;
    if (el) { el.style.setProperty("--px", 0); el.style.setProperty("--py", 0); }
    rest.onMouseLeave?.(e);
  };

  const suffix = live ? "live" : cfg.key;
  const cls = ["lg",
    gold === "edge" ? "lg--gold-edge" : "",
    gold === "tint" ? "lg--gold-tint" : "",
    motion.blik ? "m-blik" : "",
    motion.parallax ? "m-par" : "",
    motion.morph ? "m-morph" : "",
    className].filter(Boolean).join(" ");

  return (
    <div {...rest} ref={ref} className={cls} onMouseMove={onMove} onMouseLeave={onLeave}
      style={{
        "--blur": cfg.blur + "px", "--sat": cfg.sat, "--bri": cfg.bri,
        "--band": cfg.band + "px", "--r": cfg.r + "px",
        "--warp": `url(#warp-${suffix})`, "--rim": `url(#rim-${suffix})`,
        ...style,
      }}>
      <span className="lg-lens" aria-hidden style={LG_MASK} />
      {motion.blik && <span className="lg-blik" aria-hidden />}
      <span className="lg-shine" aria-hidden style={LG_MASK} />
      <div className="lg-body" style={bodyStyle}>{children}</div>
    </div>
  );
}

/* ── Lab controls ──────────────────────────────────────────────────────── */

function Slider({ label, value, min, max, step = 1, unit = "", onChange }) {
  return (
    <label style={{ display: "block" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 7 }}>
        <span style={{ fontSize: 11.5, color: "var(--text-muted)", fontWeight: 500 }}>{label}</span>
        <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--accent-hover)" }}>{value}{unit}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{ width: "100%", accentColor: "var(--accent)", height: 4, cursor: "pointer" }} />
    </label>
  );
}

function Toggle({ label, on, onChange, hint }) {
  return (
    <button onClick={() => onChange(!on)} style={{
      display: "flex", alignItems: "center", gap: 11, width: "100%", padding: "9px 11px",
      background: on ? "var(--accent-fill)" : "var(--w-04)", cursor: "pointer", textAlign: "left",
      border: "1px solid", borderColor: on ? "var(--border-gold-subtle)" : "var(--border-subtle)",
      borderRadius: "var(--radius-md)", fontFamily: "var(--font-sans)", transition: "all var(--dur-fast)",
    }}>
      <span style={{
        width: 34, height: 20, borderRadius: 999, flexShrink: 0, position: "relative",
        background: on ? "var(--accent)" : "var(--w-16)", transition: "background var(--dur-fast)",
      }}>
        <span style={{
          position: "absolute", top: 2, left: on ? 16 : 2, width: 16, height: 16, borderRadius: 999,
          background: on ? "var(--text-on-gold)" : "#e8e8e5", transition: "left var(--dur-fast) var(--ease-out)",
        }} />
      </span>
      <span style={{ flex: 1 }}>
        <span style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: on ? "var(--accent-hover)" : "var(--text-strong)" }}>{label}</span>
        {hint && <span style={{ display: "block", fontSize: 10.5, color: "var(--text-subtle)", marginTop: 1 }}>{hint}</span>}
      </span>
    </button>
  );
}

function Seg({ options, value, onChange }) {
  return (
    <div style={{ display: "flex", gap: 4, padding: 4, background: "var(--black-800)", borderRadius: "var(--radius-lg)", border: "1px solid var(--border-subtle)" }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button key={o.value} onClick={() => onChange(o.value)} style={{
            flex: 1, padding: "7px 6px", borderRadius: "var(--radius-md)", border: "none", cursor: "pointer",
            background: on ? "var(--accent-fill-strong)" : "transparent", fontFamily: "var(--font-sans)",
            color: on ? "var(--accent-hover)" : "var(--text-muted)", fontSize: 12, fontWeight: on ? 600 : 500,
            transition: "all var(--dur-fast)", whiteSpace: "nowrap",
          }}>{o.label}</button>
        );
      })}
    </div>
  );
}

function Eyebrow({ children, style = {} }) {
  return <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.14em", color: "var(--text-subtle)", fontWeight: 600, ...style }}>{children}</div>;
}

function SectionHead({ n, title, desc }) {
  return (
    <div style={{ marginBottom: 22, maxWidth: 640 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 9 }}>
        <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--accent)", border: "1px solid var(--border-gold-subtle)", borderRadius: 999, padding: "3px 9px" }}>{n}</span>
        <h2 style={{ margin: 0, fontSize: 21, fontWeight: 600, letterSpacing: "-0.02em", color: "var(--text-strong)" }}>{title}</h2>
      </div>
      {desc && <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.6, color: "var(--text-muted)" }}>{desc}</p>}
    </div>
  );
}

Object.assign(window, { GLASS_PRESETS, setFilterScale, LiquidGlass, Slider, Toggle, Seg, Eyebrow, SectionHead });
