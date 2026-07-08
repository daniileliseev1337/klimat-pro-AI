import React from "react";

export interface TooltipProps {
  /** Tooltip text. */
  content: React.ReactNode;
  children: React.ReactNode;
  /** @default "top" */
  side?: "top" | "bottom" | "left" | "right";
}

/** Small hover/focus label on a dark glass chip. */
export function Tooltip(props: TooltipProps): JSX.Element;
