import React from "react";

/**
 * EmptyState — the calm "nothing here yet" panel. Centered icon, title, line
 * and an optional action. Used for empty tables, search misses, fresh accounts.
 */
export function EmptyState({ icon = null, title, description = null, action = null, style = {} }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", padding: "44px 24px", ...style }}>
      {icon && (
        <div style={{
          width: 52, height: 52, borderRadius: "var(--radius-xl)", display: "grid", placeItems: "center", marginBottom: 16,
          color: "var(--accent)", background: "var(--accent-fill-subtle)", border: "1px solid var(--border-gold-subtle)",
        }}>{icon}</div>
      )}
      <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text-strong)", letterSpacing: "var(--ls-tight)" }}>{title}</div>
      {description && <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 6, maxWidth: 340, lineHeight: 1.55 }}>{description}</div>}
      {action && <div style={{ marginTop: 18 }}>{action}</div>}
    </div>
  );
}
