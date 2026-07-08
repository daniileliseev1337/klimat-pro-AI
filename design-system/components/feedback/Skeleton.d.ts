import React from "react";

export interface SkeletonProps {
  w?: number | string;
  h?: number | string;
  radius?: number | string;
  /** Stacked text rows (last is shortened). @default 1 */
  lines?: number;
  gap?: number;
}

/** Loading placeholder with the brand gold shimmer. */
export function Skeleton(props: SkeletonProps): JSX.Element;
