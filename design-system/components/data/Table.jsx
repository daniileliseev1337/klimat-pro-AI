import React from "react";

/**
 * Table — the data workhorse for ledgers, project lists and reports.
 * Define `columns` ({ key, label, align?, width?, render? }) and pass `rows`.
 * Numeric columns get tabular figures automatically when align="right".
 * `onRowClick` makes rows interactive; `density` tightens row height.
 */
export function Table({ columns = [], rows = [], onRowClick = null, density = "comfortable", stickyHeader = true, style = {}, ...rest }) {
  const padY = density === "compact" ? 8 : 12;
  return (
    <div {...rest} style={{ width: "100%", overflowX: "auto", ...style }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontVariantNumeric: "tabular-nums" }}>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} style={{
                position: stickyHeader ? "sticky" : "static", top: 0,
                textAlign: c.align || "left", padding: `0 14px 10px`,
                fontSize: "var(--fs-micro)", textTransform: "uppercase", letterSpacing: "var(--ls-eyebrow)",
                fontWeight: 600, color: "var(--text-subtle)", whiteSpace: "nowrap",
                borderBottom: "1px solid var(--border-default)", background: "var(--surface-card)",
                width: c.width,
              }}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={row.id ?? ri}
              onClick={onRowClick ? () => onRowClick(row, ri) : undefined}
              style={{ cursor: onRowClick ? "pointer" : "default", transition: "background var(--dur-fast)" }}
              onMouseEnter={(e) => { if (onRowClick) e.currentTarget.style.background = "var(--w-04)"; }}
              onMouseLeave={(e) => { if (onRowClick) e.currentTarget.style.background = "transparent"; }}>
              {columns.map((c) => (
                <td key={c.key} style={{
                  textAlign: c.align || "left", padding: `${padY}px 14px`,
                  fontSize: "var(--fs-base)", color: "var(--text-body)",
                  borderBottom: ri < rows.length - 1 ? "1px solid var(--border-subtle)" : "none",
                  whiteSpace: c.wrap ? "normal" : "nowrap",
                }}>
                  {c.render ? c.render(row[c.key], row, ri) : row[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
