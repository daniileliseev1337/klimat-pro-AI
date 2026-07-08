import React from "react";

/**
 * Button — the primary action control.
 * variant: "primary" (gold fill, black ink) · "secondary" (gold-tinted) ·
 *          "ghost" (hairline border) · "danger" (rose) · "subtle" (text only)
 * size: "sm" | "md" | "lg".  Pass `icon` for a leading lucide-style node.
 */
export function Button({
  children,
  variant = "primary",
  size = "md",
  icon = null,
  iconRight = null,
  disabled = false,
  loading = false,
  full = false,
  style = {},
  ...rest
}) {
  const sizes = {
    sm: { padding: "6px 12px", fontSize: 13, radius: 8, gap: 6, h: 32 },
    md: { padding: "9px 16px", fontSize: 14, radius: 8, gap: 7, h: 38 },
    lg: { padding: "12px 22px", fontSize: 15, radius: 10, gap: 8, h: 46 },
  }[size];

  const variants = {
    primary: {
      background: "var(--accent)",
      color: "var(--text-on-gold)",
      border: "1px solid transparent",
      fontWeight: 600,
    },
    secondary: {
      background: "var(--accent-fill)",
      color: "var(--accent-hover)",
      border: "1px solid var(--border-gold-subtle)",
      fontWeight: 600,
    },
    ghost: {
      background: "transparent",
      color: "var(--text-muted)",
      border: "1px solid var(--border-default)",
      fontWeight: 500,
    },
    danger: {
      background: "var(--danger-fill)",
      color: "var(--danger)",
      border: "1px solid var(--danger-border)",
      fontWeight: 600,
    },
    subtle: {
      background: "transparent",
      color: "var(--text-subtle)",
      border: "1px solid transparent",
      fontWeight: 500,
    },
  }[variant];

  const [hover, setHover] = React.useState(false);
  const isDisabled = disabled || loading;

  const hoverPatch = !isDisabled && hover
    ? {
        primary: { background: "var(--accent-hover)" },
        secondary: { borderColor: "var(--border-gold)", color: "var(--gold-300)" },
        ghost: { borderColor: "var(--border-strong)", color: "var(--text-strong)" },
        danger: { background: "rgba(248,163,163,0.16)" },
        subtle: { color: "var(--text-body)" },
      }[variant]
    : {};

  return (
    <button
      {...rest}
      disabled={isDisabled}
      onMouseEnter={(e) => { setHover(true); rest.onMouseEnter?.(e); }}
      onMouseLeave={(e) => { setHover(false); rest.onMouseLeave?.(e); }}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: sizes.gap,
        width: full ? "100%" : "auto",
        minHeight: sizes.h,
        padding: sizes.padding,
        fontSize: sizes.fontSize,
        fontFamily: "var(--font-sans)",
        letterSpacing: "-0.006em",
        borderRadius: sizes.radius,
        cursor: isDisabled ? "not-allowed" : "pointer",
        opacity: isDisabled ? 0.45 : 1,
        whiteSpace: "nowrap",
        transition: "background var(--dur-fast) var(--ease-out), color var(--dur-fast), border-color var(--dur-fast), transform var(--dur-instant)",
        transform: hover && !isDisabled ? "translateY(-0.5px)" : "none",
        ...variants,
        ...hoverPatch,
        ...style,
      }}
      onMouseDown={(e) => { if (!isDisabled) e.currentTarget.style.transform = "scale(0.975)"; }}
      onMouseUp={(e) => { if (!isDisabled) e.currentTarget.style.transform = "translateY(-0.5px)"; }}
    >
      {loading
        ? <span style={{
            width: 14, height: 14, borderRadius: "50%",
            border: "2px solid currentColor", borderTopColor: "transparent",
            display: "inline-block", animation: "kp-spin 0.7s linear infinite",
          }} />
        : icon}
      {children}
      {iconRight}
      <style>{`@keyframes kp-spin{to{transform:rotate(360deg)}}`}</style>
    </button>
  );
}
