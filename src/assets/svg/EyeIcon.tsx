import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';

import { useConcealProgress } from '@/components/motion/useConcealProgress';
import { colors } from '@/theme/tokens';

const DEFAULT_SIZE = 22;

/** How small the slash starts before it settles at full length. */
const SLASH_ENTER_SCALE = 0.4;

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
 *
 * The slash runs on the same clock as the figures it conceals. It used to mount and unmount with the
 * boolean, which was fine while the balances swapped instantly and became the one thing that popped
 * once they started easing — on the very control being pressed. It scales out along its own diagonal
 * as it fades, so it reads as being drawn across the eye rather than as appearing on top of it.
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
  const conceal = useConcealProgress(hidden);

  // Animated on a wrapping view rather than on the path's own `strokeDashoffset`: a transform and an
  // opacity on a plain View are composited on every platform, where animating an SVG presentation
  // attribute depends on the renderer forwarding it and is the kind of thing that silently does
  // nothing on one platform.
  const slashStyle = useAnimatedStyle(() => ({
    opacity: conceal.value,
    transform: [
      { rotate: '-45deg' },
      { scaleX: SLASH_ENTER_SCALE + (1 - SLASH_ENTER_SCALE) * conceal.value },
      { rotate: '45deg' },
    ],
  }));

  return (
    <View style={{ width: size, height: size }}>
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
      </Svg>

      {/* Its own layer so the eye behind it never fades with it. The rotate-scale-rotate sandwich
          stretches the slash along the diagonal it is drawn on: scaling a bottom-left to top-right
          stroke on X alone would shear it off its own axis. */}
      <Animated.View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, slashStyle]}
      >
        <Svg height={size} viewBox="0 0 24 24" width={size}>
          <Path
            d="M4.4 19.6 19.6 4.4"
            fill="none"
            stroke={color}
            strokeLinecap="round"
            strokeWidth={1.7}
          />
        </Svg>
      </Animated.View>
    </View>
  );
}
