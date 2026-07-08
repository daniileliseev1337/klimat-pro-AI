import React from "react";

/**
 * Skeleton — a loading placeholder with the brand's gold shimmer sweep.
 * Use `w`/`h`/`radius` for blocks; `lines` for stacked text rows.
 */
export function Skeleton({ w = "100%", h = 14, radius = "var(--radius-sm)", lines = 1, gap = 10, style = {} }) {
  const bar = (key, width) => (
    <span key={key} style={{
      display: "block", width, height: h, borderRadius: radius,
      background: "linear-gradient(100deg, var(--w-04) 30%, var(--gold-a12) 50%, var(--w-04) 70%)",
      backgroundSize: "220% 100%", animation: "kp-shimmer 1.4s ease-in-out infinite",
    }} />
  );
  return (
    <span style={{ display: "flex", flexDirection: "column", gap, ...style }}>
      {Array.from({ length: lines }).map((_, i) =>
        bar(i, lines > 1 && i === lines - 1 ? "62%" : w))}
      <style>{`@keyframes kp-shimmer{0%{background-position:180% 0}100%{background-position:-80% 0}}`}</style>
    </span>
  );
}
