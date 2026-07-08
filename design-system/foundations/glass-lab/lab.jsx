/* ============================================================================
   lab.jsx — Liquid Glass lab (Klimat Pro). Uses window.LiquidGlass + controls
   from glass.jsx. Renders the playground, the 4 material tiers, the 2 gold
   treatments, the 3 motion modes, and applied surfaces (KPI · ⌘K dock ·
   modal + toast). Mounts into #root.
   ========================================================================== */

const { useState, useEffect, useRef } = React;
const LG = window.LiquidGlass, P = window.GLASS_PRESETS;
const { Slider, Toggle, Seg, Eyebrow, SectionHead, setFilterScale } = window;

const PRESET_SCALES = { sheer: [18, 45], frost: [26, 60], gel: [58, 118], crystal: [40, 95] };
const rub = (n) => new Intl.NumberFormat("ru-RU").format(n) + " ₽";

/* ── tiny inline icons (stroke) ─────────────────────────────────────────── */
const Ic = {
  search: (p) => <svg width={p.s || 16} height={p.s || 16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.2-3.2" /></svg>,
  close: (p) => <svg width={p.s || 16} height={p.s || 16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>,
  check: (p) => <svg width={p.s || 16} height={p.s || 16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><path d="m4 12 5 5L20 6" /></svg>,
  bolt: (p) => <svg width={p.s || 16} height={p.s || 16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" /></svg>,
  plus: (p) => <svg width={p.s || 16} height={p.s || 16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>,
  arrow: (p) => <svg width={p.s || 16} height={p.s || 16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>,
};

const Kbd = ({ children }) => <kbd style={{ font: "inherit", fontSize: 11, fontWeight: 700, fontFamily: "var(--font-mono)", padding: "2px 6px", borderRadius: "var(--radius-sm)", background: "linear-gradient(180deg, var(--gold-a20), var(--gold-a12))", border: "1px solid var(--gold-a30)", color: "var(--accent-hover)" }}>{children}</kbd>;

function MiniSpark({ w = 160, h = 40, color = "var(--accent)" }) {
  const pts = [8, 14, 11, 20, 17, 15, 24, 22, 30, 28, 36];
  const max = Math.max(...pts), min = Math.min(...pts);
  const d = pts.map((v, i) => `${(i / (pts.length - 1)) * w},${h - ((v - min) / (max - min)) * (h - 6) - 3}`).join(" ");
  return (
    <svg width={w} height={h} style={{ display: "block", overflow: "visible" }}>
      <polyline points={d} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={w} cy={h - ((pts[pts.length - 1] - min) / (max - min)) * (h - 6) - 3} r="3" fill={color} />
    </svg>
  );
}

/* KPI content that sits inside a glass pane */
function KpiBody({ big = false }) {
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <Eyebrow>Свободный остаток</Eyebrow>
          <div style={{ fontSize: big ? 44 : 30, fontWeight: 700, letterSpacing: "-0.022em", color: "var(--text-strong)", marginTop: 8, fontVariantNumeric: "tabular-nums" }}>{rub(842500)}</div>
        </div>
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--success)", background: "var(--success-fill)", border: "1px solid var(--success-border)", borderRadius: 999, padding: "3px 9px" }}>▲ 8,4%</span>
      </div>
      <div style={{ marginTop: big ? 20 : 14 }}><MiniSpark w={big ? 300 : 190} /></div>
      <div style={{ display: "flex", gap: big ? 28 : 18, marginTop: big ? 20 : 14 }}>
        <div><div style={{ fontSize: 11, color: "var(--text-subtle)" }}>Приход</div><div style={{ fontSize: 15, fontWeight: 600, color: "var(--text-body)", marginTop: 3, fontVariantNumeric: "tabular-nums" }}>+ 420 000</div></div>
        <div><div style={{ fontSize: 11, color: "var(--text-subtle)" }}>Расход</div><div style={{ fontSize: 15, fontWeight: 600, color: "var(--text-body)", marginTop: 3, fontVariantNumeric: "tabular-nums" }}>− 397 500</div></div>
      </div>
    </div>
  );
}

/* ── Section 1 · Playground ─────────────────────────────────────────────── */
function Playground() {
  const [preset, setPreset] = useState("");
  const [v, setV] = useState({ blur: 19, sat: 2, bri: 0.9, band: 14, r: 60, warp: 40, rim: 0 });
  const [gold, setGold] = useState("edge");
  const [motion, setMotion] = useState({ blik: true, parallax: true, morph: false });
  useEffect(() => { setFilterScale("warp-live", v.warp); setFilterScale("rim-live", v.rim); }, [v.warp, v.rim]);

  const applyPreset = (k) => {
    setPreset(k); const [w, r] = PRESET_SCALES[k]; const pp = P[k];
    setV({ blur: pp.blur, sat: pp.sat, bri: pp.bri, band: pp.band, r: pp.r + 4, warp: w, rim: r });
  };
  const cfg = { blur: v.blur, sat: v.sat, bri: v.bri, band: v.band, r: v.r, key: "live" };
  const set = (k) => (val) => { setV((s) => ({ ...s, [k]: val })); setPreset(""); };

  return (
    <section style={{ marginBottom: 64 }}>
      <SectionHead n="01" title="Песочница" desc="Живой образец материала. Крути параметры справа — фон под стеклом преломляется в реальном времени. Пресеты задают готовые рецепты; дальше можно докрутить руками." />
      <div style={{ display: "flex", gap: 22, alignItems: "stretch", flexWrap: "wrap" }}>
        {/* hero */}
        <LG cfg={cfg} gold={gold} motion={motion} live style={{ flex: "1 1 460px", minHeight: 320, padding: 30 }} bodyStyle={{ height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
          <KpiBody big />
          <div style={{ display: "flex", gap: 10, marginTop: 24 }}>
            <GlassBtn primary>Внести</GlassBtn>
            <GlassBtn>Перевод</GlassBtn>
          </div>
        </LG>

        {/* control rail */}
        <div style={{ width: 322, flexShrink: 0, borderRadius: "var(--radius-xl)", border: "1px solid var(--border-default)", background: "rgba(14,14,13,0.74)", backdropFilter: "blur(18px)", WebkitBackdropFilter: "blur(18px)", padding: 18, display: "flex", flexDirection: "column", gap: 16, boxShadow: "var(--shadow-lg)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <Eyebrow>Материал</Eyebrow>
            <button onClick={() => applyPreset("gel")} style={{ fontSize: 11, color: "var(--text-subtle)", background: "none", border: "none", cursor: "pointer", fontFamily: "var(--font-sans)" }}>сброс</button>
          </div>
          <Seg value={preset} onChange={applyPreset} options={[{ value: "sheer", label: "Sheer" }, { value: "frost", label: "Frost" }, { value: "gel", label: "Gel" }, { value: "crystal", label: "Crystal" }]} />
          <div style={{ display: "flex", flexDirection: "column", gap: 13 }}>
            <Slider label="Размытие" value={v.blur} min={0} max={24} step={0.5} unit="px" onChange={set("blur")} />
            <Slider label="Рефракция тела" value={v.warp} min={0} max={120} onChange={set("warp")} />
            <Slider label="Линза кромки" value={v.rim} min={0} max={200} onChange={set("rim")} />
            <Slider label="Насыщенность" value={v.sat} min={1} max={2.4} step={0.05} unit="×" onChange={set("sat")} />
            <Slider label="Яркость" value={v.bri} min={0.9} max={1.3} step={0.01} unit="×" onChange={set("bri")} />
            <Slider label="Скругление" value={v.r} min={12} max={60} unit="px" onChange={set("r")} />
          </div>
          <div><Eyebrow style={{ marginBottom: 8 }}>Золото</Eyebrow>
            <Seg value={gold} onChange={setGold} options={[{ value: "none", label: "Без" }, { value: "edge", label: "Кромка" }, { value: "tint", label: "Тинт" }]} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            <Eyebrow style={{ marginBottom: 1 }}>Движение</Eyebrow>
            <Toggle label="Блик за курсором" on={motion.blik} onChange={(x) => setMotion((m) => ({ ...m, blik: x }))} />
            <Toggle label="Параллакс-рефракция" on={motion.parallax} onChange={(x) => setMotion((m) => ({ ...m, parallax: x }))} />
            <Toggle label="Морфинг кромки" on={motion.morph} onChange={(x) => setMotion((m) => ({ ...m, morph: x }))} />
          </div>
        </div>
      </div>
    </section>
  );
}

function GlassBtn({ children, primary, onClick, style = {} }) {
  const [h, setH] = useState(false);
  return (
    <button onClick={onClick} onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)} style={{
      padding: "10px 18px", borderRadius: "var(--radius-md)", cursor: "pointer", fontFamily: "var(--font-sans)",
      fontSize: 13.5, fontWeight: 600, transition: "all var(--dur-fast)",
      border: primary ? "none" : "1px solid var(--border-strong)",
      color: primary ? "var(--text-on-gold)" : "var(--text-strong)",
      background: primary ? (h ? "var(--accent-hover)" : "linear-gradient(180deg,var(--gold-400),var(--gold-500))")
        : (h ? "var(--w-10)" : "var(--w-04)"),
      backdropFilter: primary ? "none" : "blur(6px)", WebkitBackdropFilter: primary ? "none" : "blur(6px)",
      boxShadow: primary ? (h ? "var(--glow-gold-md)" : "var(--shadow-sm)") : "var(--glass-bevel)",
      ...style,
    }}>{children}</button>
  );
}

/* ── Section 2 · Material tiers ─────────────────────────────────────────── */
function Tiers() {
  const order = ["sheer", "frost", "gel", "crystal"];
  return (
    <section style={{ marginBottom: 64 }}>
      <SectionHead n="02" title="Четыре тира материала" desc="Один язык, четыре плотности — под задачу поверхности. От лёгкого Sheer для навигации до плотного Frost для модалок." />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 18 }}>
        {order.map((k) => {
          const pp = P[k];
          return (
            <LG key={k} cfg={{ blur: pp.blur, sat: pp.sat, bri: pp.bri, band: pp.band, r: pp.r, key: pp.key }} motion={{ blik: true }} style={{ minHeight: 194, padding: 20 }} bodyStyle={{ height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text-strong)", letterSpacing: "-0.01em" }}>{pp.ru}</div>
                <div style={{ fontSize: 11.5, fontFamily: "var(--font-mono)", color: "var(--accent)", marginTop: 3 }}>{pp.label}</div>
              </div>
              <div>
                <div style={{ fontSize: 26, fontWeight: 700, color: "var(--text-strong)", fontVariantNumeric: "tabular-nums", letterSpacing: "-0.02em" }}>{pp.blur}px</div>
                <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 6, lineHeight: 1.45 }}>{pp.note}</div>
              </div>
            </LG>
          );
        })}
      </div>
    </section>
  );
}

/* ── Section 3 · Gold treatments ────────────────────────────────────────── */
function GoldSection() {
  const cfg = { blur: P.gel.blur, sat: P.gel.sat, bri: P.gel.bri, band: P.gel.band, r: 26, key: "gel" };
  const Card = ({ gold, tag, title, desc }) => (
    <LG cfg={cfg} gold={gold} motion={{ blik: true }} style={{ flex: "1 1 300px", minHeight: 210, padding: 24 }} bodyStyle={{ height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ width: 34, height: 34, borderRadius: 10, display: "grid", placeItems: "center", color: "var(--accent)", background: "var(--accent-fill)", border: "1px solid var(--border-gold-subtle)" }}>{Ic.bolt({ s: 18 })}</span>
        <span style={{ fontSize: 11.5, fontFamily: "var(--font-mono)", color: "var(--accent)" }}>{tag}</span>
      </div>
      <div>
        <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text-strong)", letterSpacing: "-0.01em" }}>{title}</div>
        <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 7, lineHeight: 1.55 }}>{desc}</div>
      </div>
    </LG>
  );
  return (
    <section style={{ marginBottom: 64 }}>
      <SectionHead n="03" title="Роль золота — два прочтения" desc="Золото — единственный «горящий» цвет системы, так что в стекле оно работает точечно. Вот оба варианта из брифа, рядом." />
      <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
        <Card gold="edge" tag="1 · gold-edge" title="Золотой блик по кромке" desc="Тёплый specular-бевел и линзование края отливают золотом. Для одной hero-карточки на экране — самой важной." />
        <Card gold="tint" tag="2 · gold-tint" title="Тёплый тинт изнутри" desc="Стекло чуть золотит проходящий свет. Спокойнее — годится, когда золотых поверхностей на экране несколько." />
      </div>
    </section>
  );
}

/* ── Section 4 · Motion ─────────────────────────────────────────────────── */
function MotionSection() {
  const cfg = { blur: 5, sat: 1.8, bri: 1.0, band: 16, r: 24, key: "gel" };
  const Tile = ({ motion, title, desc, cue }) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <LG cfg={cfg} motion={motion} gold="edge" style={{ minHeight: 168, padding: 20 }} bodyStyle={{ height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
        <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--accent)", alignSelf: "flex-start", border: "1px solid var(--border-gold-subtle)", borderRadius: 999, padding: "3px 9px" }}>{cue}</span>
        <div style={{ fontSize: 26, fontWeight: 700, color: "var(--text-strong)", letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums" }}>{rub(842500)}</div>
      </LG>
      <div>
        <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-strong)" }}>{title}</div>
        <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginTop: 4, lineHeight: 1.5 }}>{desc}</div>
      </div>
    </div>
  );
  return (
    <section style={{ marginBottom: 64 }}>
      <SectionHead n="04" title="Живость — три режима" desc="Чем «жидкое» стекло отличается от статичного. Наведи и подвигай курсором внутри каждой карточки." />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 18 }}>
        <Tile motion={{ blik: true }} cue="наведи" title="Блик за курсором" desc="Мягкое световое пятно скользит по стеклу вслед за указателем." />
        <Tile motion={{ parallax: true }} cue="подвигай" title="Параллакс-рефракция" desc="Стекло чуть наклоняется, линза края смещается — эффект толщины." />
        <Tile motion={{ morph: true }} cue="наведи" title="Морфинг кромки" desc="При наведении углы «оживают» и плавно перетекают, линза усиливается." />
      </div>
    </section>
  );
}

/* ── Section 5 · Applied ────────────────────────────────────────────────── */
function Applied({ onOpenModal }) {
  const gel = { blur: 6, sat: 1.75, bri: 1.0, band: 16, r: 20, key: "gel" };
  return (
    <section style={{ marginBottom: 40 }}>
      <SectionHead n="05" title="В деле" desc="Материал на реальных поверхностях Klimat Pro: карточка KPI, плавающий док ⌘K, модалка и тост." />
      {/* KPI row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginBottom: 22 }}>
        {[["Активные проекты", "14", "+2 за месяц"], ["Дебиторка", rub(1240000), "3 счёта"], ["Задачи сегодня", "6", "2 — высокий приоритет"]].map(([t, val, sub], i) => (
          <LG key={i} cfg={gel} gold={i === 0 ? "edge" : "none"} motion={{ blik: true }} style={{ padding: 20 }}>
            <Eyebrow>{t}</Eyebrow>
            <div style={{ fontSize: 30, fontWeight: 700, color: "var(--text-strong)", marginTop: 8, letterSpacing: "-0.022em", fontVariantNumeric: "tabular-nums" }}>{val}</div>
            <div style={{ fontSize: 12, color: "var(--text-subtle)", marginTop: 5 }}>{sub}</div>
          </LG>
        ))}
      </div>

      {/* ⌘K dock */}
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 14 }}>
        <LG cfg={{ blur: 10, sat: 1.7, bri: 1.0, band: 14, r: 999, key: "gel" }} gold="edge" motion={{ blik: true }} style={{ width: "min(680px, 100%)", padding: "10px 12px" }} bodyStyle={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ color: "var(--accent)", display: "grid", placeItems: "center", width: 34, height: 34, borderRadius: 999, background: "var(--accent-fill)" }}>{Ic.search({ s: 17 })}</span>
          <span style={{ flex: 1, color: "var(--text-muted)", fontSize: 14 }}>Команда или переход…</span>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            {["Внести", "Счёт", "Задача"].map((c) => <span key={c} style={{ fontSize: 12, color: "var(--text-body)", padding: "5px 11px", borderRadius: 999, background: "var(--w-06)", border: "1px solid var(--border-subtle)" }}>{c}</span>)}
            <span style={{ display: "inline-flex", gap: 3, marginLeft: 4 }}><Kbd>⌘</Kbd><Kbd>K</Kbd></span>
          </div>
        </LG>
      </div>
      <div style={{ textAlign: "center", marginBottom: 26 }}>
        <div style={{ fontSize: 12, color: "var(--text-subtle)" }}>Плавающий док / командная строка — стекло на радиусе pill</div>
      </div>

      {/* modal + toast trigger */}
      <div style={{ display: "flex", justifyContent: "center", gap: 12 }}>
        <GlassBtn primary onClick={onOpenModal}>Открыть модалку из стекла</GlassBtn>
      </div>
    </section>
  );
}

function GlassModal({ open, onClose, onDone }) {
  if (!open) return null;
  const cfg = { blur: P.frost.blur, sat: 1.55, bri: 0.94, band: 18, r: 18, key: "frost" };
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 1000, display: "grid", placeItems: "center", padding: 24, background: "rgba(6,6,6,0.5)", backdropFilter: "blur(5px)", WebkitBackdropFilter: "blur(5px)", animation: "lgFade .25s var(--ease-out)" }}>
      <LG cfg={cfg} gold="edge" onClick={(e) => e.stopPropagation()} style={{ width: 460, maxWidth: "100%", padding: 26 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
          <div style={{ fontSize: 18, fontWeight: 600, color: "var(--text-strong)", letterSpacing: "-0.01em" }}>Выставить счёт</div>
          <button onClick={onClose} style={{ background: "var(--w-06)", border: "1px solid var(--border-subtle)", color: "var(--text-muted)", width: 30, height: 30, borderRadius: 8, cursor: "pointer", display: "grid", placeItems: "center" }}>{Ic.close({ s: 15 })}</button>
        </div>
        <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 18 }}>Модалка на матовом стекле (Frost) — фон читается, но текст остаётся контрастным.</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
          {["ООО «Стройинвест»", "Договор № 2024-14"].map((t, i) => (
            <div key={i} style={{ padding: "11px 13px", borderRadius: "var(--radius-md)", background: "var(--black-800)", border: "1px solid var(--border-default)", fontSize: 13.5, color: "var(--text-body)" }}>{t}</div>
          ))}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "13px 15px", borderRadius: "var(--radius-md)", background: "var(--black-800)", border: "1px solid var(--border-gold-subtle)" }}>
            <span style={{ fontSize: 13, color: "var(--text-muted)" }}>К оплате с НДS</span>
            <span style={{ fontSize: 20, fontWeight: 600, color: "var(--accent-hover)", fontVariantNumeric: "tabular-nums" }}>{rub(510000)}</span>
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 22 }}>
          <GlassBtn onClick={onClose}>Отмена</GlassBtn>
          <GlassBtn primary onClick={onDone}>Выставить счёт</GlassBtn>
        </div>
      </LG>
    </div>
  );
}

function Toast({ msg, onClose }) {
  useEffect(() => { const t = setTimeout(onClose, 2800); return () => clearTimeout(t); }, [msg]);
  const cfg = { blur: 10, sat: 1.7, bri: 1.0, band: 12, r: 999, key: "gel" };
  return (
    <div style={{ position: "fixed", left: "50%", bottom: 30, transform: "translateX(-50%)", zIndex: 1100, animation: "lgRise .3s var(--ease-rise)" }}>
      <LG cfg={cfg} gold="edge" style={{ padding: "11px 18px" }} bodyStyle={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ color: "var(--accent)" }}>{Ic.check({ s: 16 })}</span>
        <span style={{ fontSize: 13.5, color: "var(--text-strong)", fontWeight: 500, whiteSpace: "nowrap" }}>{msg}</span>
      </LG>
    </div>
  );
}

/* ── Header + App ───────────────────────────────────────────────────────── */
function Header() {
  return (
    <header style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 44 }}>
      <img src="../assets/logo-mark.svg" width="46" height="46" alt="Klimat Pro" style={{ display: "block" }} />
      <div style={{ flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <h1 style={{ margin: 0, fontSize: 27, fontWeight: 700, letterSpacing: "-0.025em", color: "var(--text-strong)" }}>Жидкое стекло</h1>
          <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--accent)", border: "1px solid var(--border-gold-subtle)", borderRadius: 999, padding: "3px 10px" }}>материал</span>
        </div>
        <p style={{ margin: "6px 0 0", fontSize: 14, color: "var(--text-muted)", maxWidth: 720, lineHeight: 1.55 }}>
          Преломляющее стекло для Klimat Pro: матовость + насыщение фона, линзование кромки на настоящей <span style={{ color: "var(--text-body)" }}>feDisplacementMap</span>-рефракции и золотой specular-бевел. Заменяет прежний <span style={{ fontFamily: "var(--font-mono)", color: "var(--text-body)" }}>.glass</span> во всей системе.
        </p>
      </div>
    </header>
  );
}

function App() {
  const [modal, setModal] = useState(false);
  const [toast, setToast] = useState(null);
  const fire = (m) => setToast(m);
  return (
    <div style={{ maxWidth: 1180, margin: "0 auto", padding: "46px 40px 80px" }}>
      <Header />
      <Playground />
      <Tiers />
      <GoldSection />
      <MotionSection />
      <Applied onOpenModal={() => setModal(true)} />
      <GlassModal open={modal} onClose={() => setModal(false)} onDone={() => { setModal(false); fire("Счёт на " + rub(510000) + " создан"); }} />
      {toast && <Toast msg={toast} onClose={() => setToast(null)} />}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
