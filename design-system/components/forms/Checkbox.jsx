import React from "react";

/**
 * Checkbox — square check with the gold fill (matches the Tasks list control).
 * Controlled via `checked` / `onChange`. Pass `label` for an inline row.
 */
export function Checkbox({ checked = false, onChange, label = null, disabled = false, size = 18, style = {}, ...rest }) {
  return (
    <label style={{ display: "inline-flex", alignItems: "center", gap: 9, cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1, ...style }}>
      <span {...rest} onClick={() => !disabled && onChange?.(!checked)} style={{
        width: size, height: size, flexShrink: 0, borderRadius: 6,
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        border: checked ? "none" : "1.5px solid var(--border-strong)",
        background: checked ? "var(--accent)" : "transparent",
        color: "var(--text-on-gold)", transition: "all var(--dur-fast) var(--ease-out)",
        boxShadow: checked ? "0 0 12px -3px var(--accent-glow)" : "none",
      }}>
        {checked && (
          <svg width={size * 0.62} height={size * 0.62} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l4 4L19 6" /></svg>
        )}
      </span>
      {label && <span style={{ fontSize: 13.5, color: "var(--text-body)" }}>{label}</span>}
    </label>
  );
}
