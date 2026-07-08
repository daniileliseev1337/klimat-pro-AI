import React from "react";

export interface CheckboxProps {
  checked?: boolean;
  onChange?: (checked: boolean) => void;
  label?: React.ReactNode;
  disabled?: boolean;
  size?: number;
}

/** Square gold-fill checkbox; pass `label` for an inline row. */
export function Checkbox(props: CheckboxProps): JSX.Element;
