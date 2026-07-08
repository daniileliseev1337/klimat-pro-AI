import React from "react";

export interface TableColumn {
  /** Row-object key this column reads. */
  key: string;
  /** Header label. */
  label: string;
  align?: "left" | "right" | "center";
  width?: number | string;
  /** Allow the cell to wrap (default: nowrap). */
  wrap?: boolean;
  /** Custom cell renderer: (value, row, index) => node. */
  render?: (value: any, row: any, index: number) => React.ReactNode;
}

export interface TableProps extends React.HTMLAttributes<HTMLDivElement> {
  columns: TableColumn[];
  rows: Array<Record<string, any>>;
  onRowClick?: (row: any, index: number) => void;
  /** @default "comfortable" */
  density?: "comfortable" | "compact";
  /** @default true */
  stickyHeader?: boolean;
}

/**
 * Data table for ledgers, project lists and reports — uppercase eyebrow headers,
 * hairline rows, tabular figures. Use `render` for badges, bars and money cells.
 *
 * @startingPoint section="Data" subtitle="Ledger / data table" viewport="700x260"
 */
export function Table(props: TableProps): JSX.Element;
