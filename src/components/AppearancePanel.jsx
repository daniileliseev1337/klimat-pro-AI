import { Children, cloneElement, isValidElement } from "react";
import { resolvePanelAppearance } from "../lib/appearance.js";

function joinClasses(...values) {
  return values.filter(Boolean).join(" ");
}

function composeHandlers(original, added) {
  return (event) => {
    original?.(event);
    if (!event.defaultPrevented) added(event);
  };
}

export default function AppearancePanel({
  panelId,
  appearance,
  children,
  className = "",
}) {
  const resolved = resolvePanelAppearance(appearance, panelId);
  const child = Children.only(children);
  if (!isValidElement(child)) return child;

  const updatePointer = (event) => {
    if (!["tilt", "spotlight"].includes(resolved.effectId)) return;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    const coarse = window.matchMedia?.("(pointer: coarse)")?.matches;
    if (reduced || coarse) return;
    const element = event.currentTarget;
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
  const resetPointer = (event) => {
    event.currentTarget.style.removeProperty("--kp-tilt-x");
    event.currentTarget.style.removeProperty("--kp-tilt-y");
  };

  return cloneElement(child, {
    "data-appearance-panel": panelId,
    className: joinClasses(
      child.props.className,
      "kp-appearance-surface",
      resolved.inherited ? "kp-appearance-inherited" : "kp-appearance-overridden",
      `kp-skin-${resolved.skinId}`,
      `kp-effect-${resolved.effectId}`,
      className,
    ),
    onPointerMove: composeHandlers(child.props.onPointerMove, updatePointer),
    onPointerLeave: composeHandlers(child.props.onPointerLeave, resetPointer),
  });
}
