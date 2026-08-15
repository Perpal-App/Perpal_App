import Svg, { Path, Rect } from 'react-native-svg';

import { colors } from '@/theme/tokens';

const VIEWBOX = 150;

/**
 * Stroke weights, chosen against the 150-unit box rather than in points.
 *
 * The sheet's outline is heavier than the entries inside it so the shape reads first and the lines
 * read as contents; the entries then step down in both length and opacity, which is what makes the
 * page look like it trails off rather than like three lines that failed to load.
 */
const SHEET_STROKE = 3.2;
const ENTRY_STROKE = 5;
const ENTRY_OPACITY = [0.55, 0.36, 0.2] as const;

/**
 * The sheet's box, centred in the viewBox.
 *
 * Named so the entries below can be placed against its edges rather than against numbers that have
 * to be re-derived by hand if the sheet ever moves.
 */
const SHEET_X = 28;
const SHEET_Y = 23;
const SHEET_W = 94;
const SHEET_H = 104;
/** Inset from the sheet's edge to where an entry starts. Symmetric with the longest line's end. */
const ENTRY_INSET = 18;

/**
 * A blank ledger: the activity history before anything has happened.
 *
 * Drawn from the app's own tokens rather than being commissioned art, which is why it imports
 * `colors` where the mailbox mark carries its own palette.
 *
 * Deliberately unaccented. It had a violet transfers badge on the corner, which at this size read as
 * a button sitting on the drawing — a saturated circle is the app's vocabulary for something you
 * press, and putting one on an illustration in an empty state invites a tap that does nothing. The
 * sheet alone says the same thing and stays quiet, which is what an empty state should be.
 */
export function EmptyHistoryMark({ size = 132 }: { readonly size?: number }) {
  return (
    <Svg height={size} viewBox={`0 0 ${VIEWBOX} ${VIEWBOX}`} width={size}>
      <Rect
        fill={colors.surfaceElevated}
        height={SHEET_H}
        rx={16}
        stroke={colors.borderStrong}
        strokeWidth={SHEET_STROKE}
        width={SHEET_W}
        x={SHEET_X}
        y={SHEET_Y}
      />

      {ENTRY_OPACITY.map((opacity, index) => (
        <Path
          d={entry(index)}
          key={index}
          opacity={opacity}
          stroke={colors.textMuted}
          strokeLinecap="round"
          strokeWidth={ENTRY_STROKE}
        />
      ))}
    </Svg>
  );
}

/**
 * One entry line: full measure at the top, then two thirds, then a third.
 *
 * Derived from the sheet rather than written out, so the three stay inside it and evenly spaced
 * whatever the box does.
 */
function entry(index: number): string {
  const start = SHEET_X + ENTRY_INSET;
  const measure = SHEET_W - ENTRY_INSET * 2;
  const y = SHEET_Y + 30 + index * 22;

  return `M${start} ${y}H${start + measure * (1 - index * 0.32)}`;
}
