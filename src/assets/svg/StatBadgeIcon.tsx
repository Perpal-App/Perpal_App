import Svg, {
  Defs,
  LinearGradient,
  Path,
  Rect,
  Stop,
} from 'react-native-svg';

import { colors, gradients } from '@/theme/tokens';

/**
 * A bold glyph on a flat tinted tile.
 *
 * This replaced a shaded dome. The dome's four soft layers — body ramp, roll-off, specular cap, rim
 * — need room to separate, and at badge size they collapsed into one mid-violet blob with a pale
 * glyph sitting in the middle of it. Nothing was wrong with the recipe; it was being asked to work
 * at a third of the size it reads at.
 *
 * So: two stops instead of four, a crisp inner rim instead of a fading one, and a glyph at more than
 * twice the stroke weight. The ramps are the same three the action buttons are cut from, which ties
 * a figure's badge to the material of the buttons beside it.
 */

const VIEW_BOX = 40;
const DEFAULT_SIZE = 34;
const GLYPH_STROKE = 3.1;
/** Inset by half the rim so the stroke sits inside the tile rather than straddling its edge. */
const RIM_WIDTH = 1.5;
const CORNER = 13;

export type StatBadgeName = 'pnl' | 'trades';
export type StatBadgeTone = 'accent' | 'negative' | 'positive';

/**
 * `positive` pairs a light ramp with a dark glyph, the way the action button's positive tone does —
 * white on that green does not hold at this weight.
 */
const TONES = {
  accent: { glyph: colors.onAccent, ramp: gradients.accentAction },
  negative: { glyph: colors.onAccent, ramp: gradients.shortAction },
  positive: { glyph: colors.onLight, ramp: gradients.longAction },
} as const;

/**
 * Three rising bars for activity, and an arrow whose direction comes from the tone.
 *
 * The arrow is derived rather than passed so direction and colour cannot contradict each other — an
 * up arrow on a red tile is the one state this must never render. Flat gets a horizontal bar, which
 * is the honest glyph for a position that has not moved.
 */
const GLYPHS = {
  bars: 'M13.5 27.5v-6M20 27.5v-11M26.5 27.5v-15',
  fall: 'M13.5 13.5 26.5 26.5M20 26.5h6.5V20',
  flat: 'M13 20h14',
  rise: 'M13.5 26.5 26.5 13.5M20 13.5h6.5V20',
} as const;

export type StatBadgeIconProps = {
  readonly name: StatBadgeName;
  readonly size?: number;
  readonly tone?: StatBadgeTone;
};

export function StatBadgeIcon({
  name,
  size = DEFAULT_SIZE,
  tone = 'accent',
}: StatBadgeIconProps) {
  const material = TONES[tone];
  const glyph = name === 'trades'
    ? GLYPHS.bars
    : tone === 'positive' ? GLYPHS.rise : tone === 'negative' ? GLYPHS.fall : GLYPHS.flat;

  return (
    <Svg height={size} viewBox={`0 0 ${VIEW_BOX} ${VIEW_BOX}`} width={size}>
      <Defs>
        <LinearGradient
          gradientUnits="userSpaceOnUse"
          id={`${name}-${tone}-tile`}
          x1={VIEW_BOX / 2}
          x2={VIEW_BOX / 2}
          y1={0}
          y2={VIEW_BOX}
        >
          <Stop offset={0} stopColor={material.ramp.colors[0]} />
          <Stop offset={1} stopColor={material.ramp.colors[1]} />
        </LinearGradient>
      </Defs>

      <Rect
        fill={`url(#${name}-${tone}-tile)`}
        height={VIEW_BOX}
        rx={CORNER}
        width={VIEW_BOX}
        x={0}
        y={0}
      />
      {/* One crisp highlight along the inside of the edge. It is what keeps the tile from reading as
          a flat swatch now that the dome's rim gradient is gone. */}
      <Rect
        fill="none"
        height={VIEW_BOX - RIM_WIDTH}
        rx={CORNER - RIM_WIDTH / 2}
        stroke={colors.hairline}
        strokeOpacity={0.3}
        strokeWidth={RIM_WIDTH}
        width={VIEW_BOX - RIM_WIDTH}
        x={RIM_WIDTH / 2}
        y={RIM_WIDTH / 2}
      />

      <Path
        d={glyph}
        fill="none"
        stroke={material.glyph}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={GLYPH_STROKE}
      />
    </Svg>
  );
}
