import React from "react";

/**
 * Tooltip — a small label on hover/focus. Wrap any element; `content` is the
 * text. Dark glass chip, appears above by default.
 */
export function Tooltip({ content, children, side = "top", style = {} }) {
  const [show, setShow] = React.useState(false);
  const pos = {
    top: { bottom: "calc(100% + 8px)", left: "50%", transform: "translateX(-50%)" },
    bottom: { top: "calc(100% + 8px)", left: "50%", transform: "translateX(-50%)" },
    left: { right: "calc(100% + 8px)", top: "50%", transform: "translateY(-50%)" },
    right: { left: "calc(100% + 8px)", top: "50%", transform: "translateY(-50%)" },
  }[side];
  return (
    <span style={{ position: "relative", display: "inline-flex", ...style }}
      onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)} onFocus={() => setShow(true)} onBlur={() => setShow(false)}>
      {children}
      {show && content && (
        <span role="tooltip" style={{
          position: "absolute", zIndex: "var(--z-dropdown)", ...pos, whiteSpace: "nowrap", pointerEvents: "none",
          padding: "5px 9px", fontSize: 11.5, fontWeight: 500, color: "var(--text-strong)",
          background: "linear-gradient(135deg, rgba(40,40,35,0.98), rgba(24,24,21,0.98))",
          border: "1px solid var(--border-gold-subtle)", borderRadius: "var(--radius-sm)",
          boxShadow: "var(--shadow-md)", animation: "kp-tip var(--dur-fast) var(--ease-out)",
        }}>{content}
          <style>{`@keyframes kp-tip{from{opacity:0}to{opacity:1}}`}</style>
        </span>
      )}
    </span>
  );
}
