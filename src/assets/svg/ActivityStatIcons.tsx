import Svg, { Path, Rect } from 'react-native-svg';

import { colors } from '@/theme/tokens';

/**
 * A step above the 24pt token logos in the holdings tiles, deliberately.
 *
 * A tile carries a row of logos and reads them as a set, so each one stays small. These cards carry a
 * single mark with nothing beside it, and at the tiles' size it read as undersized for the space it
 * had rather than as matching them.
 */
const DEFAULT_SIZE = 28;
const STROKE = 1.9;

export type ActivityStatIconProps = {
  readonly color?: string;
  readonly size?: number;
};

/**
 * Outlined marks for the two activity figures.
 *
 * These replaced a pair of filled violet tiles. A filled badge is a container, and a container beside a
 * label reads as a second object in the card rather than as the label's own mark — which is why they
 * were the heaviest thing in a card whose point is a number. Stroked at the same weight as the funding
 * glyphs, with no disc behind them, they sit at the figure's level instead of above it.
 *
 * Drawn as a set: one grid, one stroke weight, round caps and joins on both, so the two cards read as
 * a pair rather than as two unrelated icons.
 */

/**
 * Two candles, wicks drawn only where they clear the bodies.
 *
 * Stroked bodies mean a wick run through them would show inside the outline, so each wick is two
 * segments — above and below — which is also what real candles look like once the body is opaque.
 */
export function TradesIcon({
  color = colors.accentSoft,
  size = DEFAULT_SIZE,
}: ActivityStatIconProps) {
  return (
    <Svg height={size} viewBox="0 0 24 24" width={size}>
      <Path
        d="M8 3.5V7M8 16v4.5M16 6v3.5M16 16v4.5"
        fill="none"
        stroke={color}
        strokeLinecap="round"
        strokeWidth={STROKE}
      />
      <Rect
        fill="none"
        height={9}
        rx={1.7}
        stroke={color}
        strokeWidth={STROKE}
        width={6}
        x={5}
        y={7}
      />
      <Rect
        fill="none"
        height={6.5}
        rx={1.7}
        stroke={color}
        strokeWidth={STROKE}
        width={6}
        x={13}
        y={9.5}
      />
    </Svg>
  );
}

/**
 * A trend polyline with a corner head, or a level bar when there is nothing to show.
 *
 * Direction comes from the caller rather than from a tone, so the arrow cannot contradict the figure
 * beside it. `flat` is the honest mark for a position that has not moved — an arrow would have to pick
 * a side it has not earned.
 */
export function PnlTrendIcon({
  color = colors.accentSoft,
  direction,
  size = DEFAULT_SIZE,
}: ActivityStatIconProps & { readonly direction: 'down' | 'flat' | 'up' }) {
  return (
    <Svg height={size} viewBox="0 0 24 24" width={size}>
      <Path
        d={direction === 'flat'
          ? 'M4.5 12h15'
          : direction === 'up'
            ? 'M4 16.5 10 10.5l3.5 3.5L20 7.5M15 7.5h5v5'
            : 'M4 7.5 10 13.5l3.5-3.5L20 16.5M15 16.5h5v-5'}
        fill="none"
        stroke={color}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={STROKE}
      />
    </Svg>
  );
}
