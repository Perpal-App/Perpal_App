import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';

import { useConcealProgress } from '@/components/motion/useConcealProgress';
import { colors } from '@/theme/tokens';

/**
 * Render size. The box it sits in is 34 in both callers, so this still clears 3pt on every side and
 * no layout moves.
 */
const DEFAULT_SIZE = 28;

/** How small the slash starts before it settles at full length. */
const SLASH_ENTER_SCALE = 0.4;

/**
 * The lid, as two mirrored cubics spanning the full 2–22 width.
 *
 * Three numbers decide whether this reads as an eye, and the first two are not where they look like
 * they are. A cubic's apex is `(p0 + 3c1 + 3c2 + p3) / 8`, so a control at y 6 — which is what this
 * had — peaks the curve at 7.5, not 6: a 18x9 lid at 2.00:1, a letterbox. Opening the controls to 2.6
 * and narrowing the span fixed the flatness and broke something else, landing at 1.28:1, which is
 * round enough to read as a circle with a dot in it.
 *
 * 1.43:1 is the proportion that reads as an eye, and it is not a guess: it is what Lucide, Feather and
 * Material's visibility glyph all converge on. Controls at y 2.7 across a 20-unit span put the apex at
 * 5.03 for a 20x13.9 lid, which is that ratio. The controls stay inset 3 horizontally from each
 * corner, so the curve leaves the canthus at about 72 degrees — steep enough that the corner still
 * reads as a point through a round join, which is what stops a 2.3 stroke throwing a miter spike out
 * past the viewBox.
 */
const LID = 'M2 12C5 2.7 19 2.7 22 12C19 21.3 5 21.3 2 12Z';

/**
 * The pupil. The third number, and the one that was doing most of the damage.
 *
 * It has to be under about half the lid's height or there is no eye-white left and the glyph collapses
 * into a filled blob. At r 3 in the original 9-high lid the pupil was 67% of it with 0.65 of white
 * inside the stroke — jammed in. Grown to 3.5 in the rounder lid it was still 50%. Back to r 3 in a
 * 13.9-high lid it is 43%, the same share Lucide uses, leaving 2.8 of clear white above and below.
 *
 * Filled, not stroked. A ring this small collapses into a smudge, while a solid pupil stays a pupil —
 * and it gives the glyph one weighted point, which is what keeps an outline this size from reading as
 * an empty shape.
 */
const PUPIL = 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z';

/**
 * Bolder than the 1.7 this carried, and a touch bolder than the 2.0 the reference glyphs use.
 *
 * At 1.7 in a 22pt render the line came out at 1.56pt, which is under two device pixels at 1x and
 * reads as a hairline sketch rather than an icon. 2.3 in a 28pt render is 2.68pt — 72% more weight.
 */
const STROKE = 2.3;

/**
 * A rounded eye: an almond lid, a filled pupil, and a stroke across both when hidden.
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
          d={LID}
          fill="none"
          stroke={color}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={STROKE}
        />
        <Path d={PUPIL} fill={color} />
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
            d="M4.2 19.8 19.8 4.2"
            fill="none"
            stroke={color}
            strokeLinecap="round"
            strokeWidth={STROKE}
          />
        </Svg>
      </Animated.View>
    </View>
  );
}
