import Svg, { Path } from 'react-native-svg';

import { colors } from '@/theme/tokens';

const DEFAULT_SIZE = 22;

/**
 * A rounded eye: an almond outline, a filled pupil, and a stroke across both when hidden.
 *
 * The outline is two mirrored cubics rather than a flatter quadratic lens, opened taller so the
 * shape reads as a rounded eye rather than as a slit. Round caps and joins take the hard point off
 * the two corners where the curves meet.
 *
 * The pupil is filled, not stroked. A ring this small collapses into a smudge, while a solid pupil
 * stays a pupil — and it gives the glyph one weighted point, which is what keeps an outline of this
 * size from reading as an empty shape.
 */
export function EyeIcon({
  color = colors.textSecondary,
  hidden,
  size = DEFAULT_SIZE,
}: {
  readonly color?: string;
  readonly hidden: boolean;
  readonly size?: number;
}) {
  return (
    <Svg height={size} viewBox="0 0 24 24" width={size}>
      <Path
        d="M3 12C7 6 17 6 21 12C17 18 7 18 3 12Z"
        fill="none"
        stroke={color}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.7}
      />
      <Path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" fill={color} />
      {hidden ? (
        <Path
          d="M4.4 19.6 19.6 4.4"
          fill="none"
          stroke={color}
          strokeLinecap="round"
          strokeWidth={1.7}
        />
      ) : null}
    </Svg>
  );
}
