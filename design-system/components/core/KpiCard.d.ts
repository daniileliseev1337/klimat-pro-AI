import React from "react";

/**
 * @startingPoint section="Core" subtitle="Animated KPI metric tile" viewport="700x180"
 */
export interface KpiCardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Uppercase eyebrow label. */
  label: string;
  /** The figure (number). */
  value: number;
  /** Formatter for the figure. @default ru-RU integer */
  format?: (n: number) => string;
  /** Suffix unit, e.g. "₽" or "%". */
  unit?: string;
  /** Percent delta; sign drives the up/down arrow + color. */
  trend?: number | null;
  /** Small caption under the figure. */
  hint?: string;
  /** Leading icon (lucide). */
  icon?: React.ReactNode;
  /** Animate the figure up on mount. @default true */
  animate?: boolean;
}

/**
 * A single headline metric — animated ticker figure, trend, glass + gold edge.
 * The workhorse of the dashboard and finance views.
 */
export function KpiCard(props: KpiCardProps): JSX.Element;
