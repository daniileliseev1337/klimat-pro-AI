import React from "react";

/**
 * @startingPoint section="Core" subtitle="Glass card with gold ingot edge" viewport="700x150"
 */
export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Render the gold "ingot" gradient edge. Reserve for premium/primary cards. */
  gold?: boolean;
  /** Lift + gold glow on hover. @default true */
  hover?: boolean;
  /** Cursor-following warm spotlight. @default true */
  spotlight?: boolean;
  /** Inner padding in px. @default 18 */
  padding?: number;
}

/**
 * The universal surface — translucent dark glass with an optional gold edge.
 * Everything in the product lives inside one of these.
 */
export function Card(props: CardProps): JSX.Element;
