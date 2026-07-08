import React from "react";

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Semantic tone. Ignored when `color` is set. @default "neutral" */
  tone?: "neutral" | "gold" | "success" | "warning" | "danger" | "info";
  /** Explicit hex — use for project-stage / category colors outside the tone set. */
  color?: string;
  /** Leading status dot. */
  dot?: boolean;
  /** @default "md" */
  size?: "sm" | "md";
}

/** Compact status pill for stages, priorities and states. */
export function Badge(props: BadgeProps): JSX.Element;
