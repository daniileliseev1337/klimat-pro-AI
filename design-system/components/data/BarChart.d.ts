import React from "react";

export interface BarDatum { label: string; value: number; color?: string; }

export interface BarChartProps {
  data: BarDatum[];
  height?: number;
  gap?: number;
  /** Value formatter for the on-bar label. */
  format?: (n: number) => string | number;
}

/**
 * Compact categorical bar chart — gold gradient bars, hover highlight.
 * Pass per-datum `color` for category breakdowns.
 *
 * @startingPoint section="Data" subtitle="Categorical bar chart" viewport="700x260"
 */
export function BarChart(props: BarChartProps): JSX.Element;
