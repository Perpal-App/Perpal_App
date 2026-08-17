import Svg, { Path } from 'react-native-svg';

import { colors } from '@/theme/tokens';

/** Default footprint: reads as a unit beside 14pt label text without crowding it. */
const SIZE = 14;

/**
 * The mark on a control that opens a menu.
 *
 * Stroked rather than the `⌄` character, which is the whole reason this exists. Poppins has
 * no down arrowhead, so every selector using that character fell back to whatever face the
 * platform offered for it and drew a small letter v — a different weight from the label
 * beside it, and sitting well below its baseline. A path carries the app's own stroke
 * weight, centres in the box it is given, and scales with the control rather than with a
 * fallback font's metrics.
 *
 * The geometry matches the chevrons already drawn in the funding and withdraw panels, which
 * each hold a private copy of it; this is the one to reach for now.
 */
export function ChevronDown({
  color = colors.textMuted,
  size = SIZE,
}: {
  readonly color?: string;
  readonly size?: number;
}) {
  return (
    <Svg height={size} viewBox="0 0 24 24" width={size}>
      <Path
        d="M6 9.5 12 15.5 18 9.5"
        fill="none"
        stroke={color}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2.2}
      />
    </Svg>
  );
}
