import React from "react";

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  /** Optional CTA node (e.g. a Button). */
  action?: React.ReactNode;
}

/** Calm "nothing here yet" panel — icon, title, line, optional action. */
export function EmptyState(props: EmptyStateProps): JSX.Element;
