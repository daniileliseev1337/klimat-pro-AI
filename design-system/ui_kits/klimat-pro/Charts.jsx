/* Lightweight hand-built SVG charts — no chart lib, deterministic, on-brand.
   window.KPCharts = { AreaChart, Donut, MiniBars } */
(function () {
  const G = "#d4af37", GREEN = "#6ee7a8";

  // Stacked area: приход (gold) over расход (faint) — smooth, gridlined.
  function AreaChart({ data, width = 560, height = 200, pad = 28 }) {
    const w = width, h = height;
    const max = Math.max(...data.map(d => Math.max(d.in, d.out))) * 1.15;
    const x = i => pad + (i * (w - pad * 2)) / (data.length - 1);
    const y = v => h - pad - (v / max) * (h - pad * 2);
    const line = key => data.map((d, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(d[key]).toFixed(1)}`).join(" ");
    const area = key => `${line(key)} L${x(data.length - 1)},${h - pad} L${x(0)},${h - pad} Z`;
    const ticks = [0, 0.25, 0.5, 0.75, 1].map(t => h - pad - t * (h - pad * 2));
    return React.createElement("svg", { width: "100%", viewBox: `0 0 ${w} ${h}`, style: { display: "block", overflow: "visible" } },
      React.createElement("defs", null,
        React.createElement("linearGradient", { id: "kpArea", x1: "0", y1: "0", x2: "0", y2: "1" },
          React.createElement("stop", { offset: "0", stopColor: G, stopOpacity: "0.30" }),
          React.createElement("stop", { offset: "1", stopColor: G, stopOpacity: "0" }))),
      ticks.map((ty, i) => React.createElement("line", { key: i, x1: pad, x2: w - pad, y1: ty, y2: ty, stroke: "rgba(255,255,255,0.05)", strokeWidth: 1 })),
      React.createElement("path", { d: area("in"), fill: "url(#kpArea)" }),
      React.createElement("path", { d: line("out"), fill: "none", stroke: "rgba(255,255,255,0.22)", strokeWidth: 1.5, strokeDasharray: "4 4" }),
      React.createElement("path", { d: line("in"), fill: "none", stroke: G, strokeWidth: 2.4, strokeLinecap: "round", style: { filter: "drop-shadow(0 0 6px rgba(212,175,55,0.4))" } }),
      data.map((d, i) => React.createElement("circle", { key: i, cx: x(i), cy: y(d.in), r: 3, fill: "#0a0a0a", stroke: G, strokeWidth: 2 })),
      data.map((d, i) => React.createElement("text", { key: "t" + i, x: x(i), y: h - 8, fill: "var(--text-subtle)", fontSize: 10.5, textAnchor: "middle", fontFamily: "var(--font-mono)" }, d.m)));
  }

  // Donut for expense split.
  function Donut({ data, size = 150, thickness = 20 }) {
    const r = (size - thickness) / 2, c = size / 2, circ = 2 * Math.PI * r;
    let acc = 0;
    return React.createElement("svg", { width: size, height: size, viewBox: `0 0 ${size} ${size}` },
      React.createElement("circle", { cx: c, cy: c, r, fill: "none", stroke: "var(--w-06)", strokeWidth: thickness }),
      data.map((d, i) => {
        const len = (d.value / 100) * circ;
        const el = React.createElement("circle", {
          key: i, cx: c, cy: c, r, fill: "none", stroke: d.color, strokeWidth: thickness,
          strokeDasharray: `${len} ${circ - len}`, strokeDashoffset: -acc,
          transform: `rotate(-90 ${c} ${c})`, strokeLinecap: "butt",
        });
        acc += len; return el;
      }),
      React.createElement("text", { x: c, y: c - 2, fill: "var(--text-strong)", fontSize: 22, fontWeight: 600, textAnchor: "middle", style: { letterSpacing: "-0.02em" } }, "100%"),
      React.createElement("text", { x: c, y: c + 15, fill: "var(--text-subtle)", fontSize: 9.5, textAnchor: "middle", style: { textTransform: "uppercase", letterSpacing: "0.1em" } }, "расходы"));
  }

  window.KPCharts = { AreaChart, Donut };
})();
