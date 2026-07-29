import { useEffect, useRef } from "react";
import { resolvePanelAppearance } from "../lib/appearance.js";

export default function AppearancePanel({
  panelId,
  appearance,
  customizeMode = false,
  onSelect,
  onReset,
  children,
  className = "",
  label = "Панель",
}) {
  const ref = useRef(null);
  const resolved = resolvePanelAppearance(appearance, panelId);
  const hasOverride = !resolved.inherited;

  useEffect(() => {
    const element = ref.current;
    if (!element || !["tilt", "spotlight"].includes(resolved.effectId)) return undefined;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    const coarse = window.matchMedia?.("(pointer: coarse)")?.matches;
    if (reduced || coarse) return undefined;

    const onMove = (event) => {
      const box = element.getBoundingClientRect();
      const x = Math.max(0, Math.min(1, (event.clientX - box.left) / box.width));
      const y = Math.max(0, Math.min(1, (event.clientY - box.top) / box.height));
      element.style.setProperty("--kp-pointer-x", `${Math.round(x * 100)}%`);
      element.style.setProperty("--kp-pointer-y", `${Math.round(y * 100)}%`);
      if (resolved.effectId === "tilt") {
        element.style.setProperty("--kp-tilt-x", `${(y - 0.5) * -3}deg`);
        element.style.setProperty("--kp-tilt-y", `${(x - 0.5) * 4}deg`);
      }
    };
    const onLeave = () => {
      element.style.removeProperty("--kp-tilt-x");
      element.style.removeProperty("--kp-tilt-y");
    };
    element.addEventListener("pointermove", onMove);
    element.addEventListener("pointerleave", onLeave);
    return () => {
      element.removeEventListener("pointermove", onMove);
      element.removeEventListener("pointerleave", onLeave);
      onLeave();
    };
  }, [resolved.effectId]);

  return (
    <section
      ref={ref}
      data-appearance-panel={panelId}
      className={`kp-appearance-panel ${resolved.inherited ? "kp-appearance-inherited" : "kp-appearance-overridden"} kp-skin-${resolved.skinId} kp-effect-${resolved.effectId} ${className}`.trim()}
    >
      {customizeMode && (
        <div className="kp-panel-customize" aria-label={`Оформление: ${label}`}>
          <span>{hasOverride ? "Индивидуально" : "Общий стиль"}</span>
          <button type="button" onClick={() => onSelect?.(panelId)}>{hasOverride ? "Изменить" : "Настроить"}</button>
          {hasOverride && <button type="button" className="kp-panel-reset" onClick={() => onReset?.(panelId)}>Сбросить</button>}
        </div>
      )}
      <div className="kp-appearance-panel-body">{children}</div>
    </section>
  );
}
