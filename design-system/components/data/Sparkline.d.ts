import React from "react";

export interface SparklineProps {
  /** Series of numbers. */
  data: number[];
  width?: number;
  height?: number;
  /** Stroke color (CSS). @default gold */
  color?: string;
  /** Render the soft area fill. @default true */
  fill?: boolean;
  strokeWidth?: number;
}

/** Tiny inline trend line for table rows and KPI tiles — pure SVG, no axes. */
export function Sparkline(props: SparklineProps): JSX.Element;
