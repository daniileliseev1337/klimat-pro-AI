import React from "react";

/**
 * @startingPoint section="Core" subtitle="Gold-fill action button, 5 variants" viewport="700x150"
 */
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Visual treatment. @default "primary" */
  variant?: "primary" | "secondary" | "ghost" | "danger" | "subtle";
  /** @default "md" */
  size?: "sm" | "md" | "lg";
  /** Leading icon node (a lucide-react icon element). */
  icon?: React.ReactNode;
  /** Trailing icon node. */
  iconRight?: React.ReactNode;
  /** Show a spinner and block interaction. */
  loading?: boolean;
  /** Stretch to container width. */
  full?: boolean;
}

/**
 * The primary action control. Gold-filled `primary` for the one true action on
 * a view; `ghost` for secondary; `danger` for destructive.
 */
export function Button(props: ButtonProps): JSX.Element;
