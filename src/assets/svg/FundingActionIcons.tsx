import Svg, { Path } from 'react-native-svg';

import { colors } from '@/theme/tokens';

const DEFAULT_SIZE = 16;
/**
 * Weight, on the 24-unit grid these are drawn on.
 *
 * A 16pt render scales this by two thirds, so 3 lands at about 2 device pixels — the point where a
 * glyph beside a SemiBold label stops looking like a hairline drawn next to text and starts matching
 * its weight. The previous 2.1 was arriving at 1.4.
 */
const STROKE = 3;

export type FundingActionIconProps = {
  readonly color?: string;
  readonly size?: number;
};

/**
 * A plus for deposit, a diagonal arrow for withdraw, and a two-arc swap between them.
 *
 * The plus says "add" without needing a direction, which is what makes it read faster than the arrow
 * it replaced. It does leave the pair asymmetric — a plus against an arrow rather than a matched
 * in/out set — which is a deliberate trade for legibility at 16pt.
 */

export function DepositPlusIcon({
  color = colors.textPrimary,
  size = DEFAULT_SIZE,
}: FundingActionIconProps) {
  return (
    <Svg height={size} viewBox="0 0 24 24" width={size}>
      <Path
        d="M12 5.5v13M5.5 12h13"
        fill="none"
        stroke={color}
        strokeLinecap="round"
        strokeWidth={STROKE}
      />
    </Svg>
  );
}

/** Out and down: money leaving. */
export function WithdrawArrowIcon({
  color = colors.textPrimary,
  size = DEFAULT_SIZE,
}: FundingActionIconProps) {
  return (
    <Svg height={size} viewBox="0 0 24 24" width={size}>
      <Path
        d="M6.5 6.5 17.5 17.5M17.5 9.5v8H9.5"
        fill="none"
        stroke={color}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={STROKE}
      />
    </Svg>
  );
}

/**
 * Two arcs around a common centre, each with a corner head at its end.
 *
 * Stroked rather than the filled Material glyph, so it carries the same weight as its neighbours. The
 * arcs stop short of a full circle on purpose — a closed ring reads as a loading spinner, and this
 * control is not one. Pulled in to r=6.4 so the heavier stroke has room to sit inside the grid.
 */
export function SwapIcon({
  color = colors.textPrimary,
  size = DEFAULT_SIZE,
}: FundingActionIconProps) {
  return (
    <Svg height={size} viewBox="0 0 24 24" width={size}>
      <Path
        d="M5.6 12A6.4 6.4 0 0 1 16.5 7.4M13.3 7.6h3.6V4M18.4 12a6.4 6.4 0 0 1-10.9 4.6M10.7 16.4H7.1V20"
        fill="none"
        stroke={color}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={STROKE}
      />
    </Svg>
  );
}
