import { useRef } from "react";
import { motion, useMotionValue, useSpring, useReducedMotion } from "framer-motion";

// Кнопка, слегка «притягивающаяся» к курсору (spring). На touch / reduced-motion — обычная кнопка.
export default function MagneticButton({ children, onClick, className, style, type = "button", disabled, strength = 0.3 }) {
  const reduce = useReducedMotion();
  const ref = useRef(null);
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const x = useSpring(mx, { stiffness: 300, damping: 20 });
  const y = useSpring(my, { stiffness: 300, damping: 20 });

  const onMove = (e) => {
    if (reduce) return;
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    mx.set((e.clientX - (r.left + r.width / 2)) * strength);
    my.set((e.clientY - (r.top + r.height / 2)) * strength);
  };
  const reset = () => { mx.set(0); my.set(0); };

  return (
    <motion.button
      ref={ref}
      type={type}
      disabled={disabled}
      onMouseMove={onMove}
      onMouseLeave={reset}
      onClick={onClick}
      className={className}
      style={{ x: reduce ? 0 : x, y: reduce ? 0 : y, ...style }}
    >
      {children}
    </motion.button>
  );
}
