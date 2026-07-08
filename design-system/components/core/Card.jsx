import React from "react";

/**
 * Card — the universal surface, now cut from LIQUID GLASS. A frosted,
 * saturated pane that refracts the living background: an edge-lens ring bends
 * light at the rim and a specular bevel paints the lit 3-D edge. Optional gold
 * "ingot" edge is the brand's signature; a cursor-following spotlight warms the
 * surface on hover. Needs the #lg-warp / #lg-rim SVG filters on the page
 * (assets/liquid-glass.svg) — degrades gracefully to frost + bevel without them.
 */
export function Card({
  children,
  gold = false,
  hover = true,
  spotlight = true,
  padding = 18,
  style = {},
  ...rest
}) {
  const ref = React.useRef(null);
  const [isHover, setHover] = React.useState(false);

  const onMove = (e) => {
    if (!ref.current) return;
    const r = ref.current.getBoundingClientRect();
    ref.current.style.setProperty("--mx", `${e.clientX - r.left}px`);
    ref.current.style.setProperty("--my", `${e.clientY - r.top}px`);
    rest.onMouseMove?.(e);
  };

  const maskStyle = {
    WebkitMask: "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)",
    WebkitMaskComposite: "xor",
    maskComposite: "exclude",
  };

  return (
    <div
      {...rest}
      ref={ref}
      onMouseMove={onMove}
      onMouseEnter={(e) => { setHover(true); rest.onMouseEnter?.(e); }}
      onMouseLeave={(e) => { setHover(false); rest.onMouseLeave?.(e); }}
      style={{
        position: "relative",
        isolation: "isolate",
        background: gold ? "var(--glass-tint-gold)" : "var(--glass-tint-neutral)",
        backdropFilter: "blur(var(--glass-blur)) saturate(1.7) brightness(1.0) url(#lg-warp)",
        WebkitBackdropFilter: "blur(var(--glass-blur)) saturate(1.7) brightness(1.0)",
        borderRadius: "var(--radius-xl)",
        boxShadow: hover && isHover
          ? "var(--glass-bevel), var(--shadow-lg), var(--glow-gold-md)"
          : "var(--glass-bevel), var(--shadow-md)",
        transform: hover && isHover ? "translateY(-3px)" : "none",
        transition: "transform var(--dur-fast) var(--ease-spring), box-shadow var(--dur-fast)",
        padding,
        ...style,
      }}
    >
      {/* edge-lens refraction ring */}
      <span aria-hidden style={{
        position: "absolute", inset: 0, borderRadius: "inherit", zIndex: 1, pointerEvents: "none",
        padding: "var(--glass-lens-band)",
        backdropFilter: "blur(1px) url(#lg-rim)", WebkitBackdropFilter: "blur(1px)",
        ...maskStyle,
      }} />
      {/* specular bevel / lit edge */}
      <span aria-hidden style={{
        position: "absolute", inset: 0, borderRadius: "inherit", zIndex: 2, pointerEvents: "none",
        padding: "1.4px",
        background: gold ? "var(--glass-specular-gold)" : "var(--glass-specular)",
        ...maskStyle,
      }} />
      {/* gold ingot edge */}
      {gold && (
        <span aria-hidden style={{
          position: "absolute", inset: 0, borderRadius: "inherit",
          padding: "var(--border-ingot)", pointerEvents: "none", zIndex: 3,
          background: "linear-gradient(135deg, var(--gold-600) 0%, var(--gold-500) 22%, var(--gold-100) 46%, var(--gold-400) 56%, var(--gold-500) 72%, var(--gold-600) 100%)",
          ...maskStyle,
          opacity: isHover ? 0.95 : 0.82,
          transition: "opacity var(--dur-fast)",
        }} />
      )}
      {/* cursor spotlight */}
      {spotlight && (
        <span aria-hidden style={{
          position: "absolute", inset: 0, borderRadius: "inherit", pointerEvents: "none",
          zIndex: 3, opacity: isHover ? 1 : 0, transition: "opacity var(--dur-base)",
          background: "radial-gradient(340px circle at var(--mx,50%) var(--my,50%), var(--gold-a12), transparent 60%)",
        }} />
      )}
      <div style={{ position: "relative", zIndex: 4 }}>{children}</div>
    </div>
  );
}
