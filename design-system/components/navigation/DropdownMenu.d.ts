import React from "react";

export interface DropdownItem {
  label?: string;
  icon?: React.ReactNode;
  onClick?: () => void;
  /** Tint the item rose (destructive). */
  danger?: boolean;
  /** Right-aligned hint / shortcut. */
  hint?: string;
  /** Render a divider line instead of an item. */
  divider?: boolean;
}

export interface DropdownMenuProps {
  /** The clickable anchor (e.g. an IconButton). */
  trigger: React.ReactNode;
  items: DropdownItem[];
  /** Which edge to anchor to. @default "right" */
  align?: "left" | "right";
  width?: number;
}

/** Anchored action menu — closes on outside-click / Escape. */
export function DropdownMenu(props: DropdownMenuProps): JSX.Element;
