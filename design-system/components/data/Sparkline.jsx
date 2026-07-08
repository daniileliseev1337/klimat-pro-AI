import React from "react";

/**
 * Sparkline — a tiny inline trend line for table rows and KPI tiles. Pure SVG,
 * gold by default with a soft area fill. No axes, no labels — just the shape.
 */
export function Sparkline({ data = [], width = 96, height = 28, color = "var(--accent)", fill = true, strokeWidth = 1.6, style = {} }) {
  if (!data.length) return null;
  const min = Math.min(...data), max = Math.max(...data), range = max - min || 1;
  const x = (i) => (i / (data.length - 1)) * (width - 2) + 1;
  const y = (v) => height - 2 - ((v - min) / range) * (height - 4);
  const line = data.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const area = `${line} L${x(data.length - 1)},${height} L${x(0)},${height} Z`;
  const id = React.useId();
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: "block", overflow: "visible", ...style }}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.28" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {fill && <path d={area} fill={`url(#${id})`} />}
      <path d={line} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
