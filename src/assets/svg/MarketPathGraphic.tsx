import Svg, {
  Defs,
  G,
  Path,
  RadialGradient,
  Stop,
  Text as SvgText,
} from 'react-native-svg';

import { colors } from '@/theme/tokens';

/**
 * Market-path illustration supplied by the user, adapted to Perpal tokens.
 *
 * The source `viewBox` (`48 -119.6 277.5 118`) does not enclose its own geometry.
 * Measured union bounds of every supplied path are x 48..313.8 and y -38..79, so
 * the box below is those bounds plus 4 units of padding for the stroke. Nothing
 * is cropped and the artwork is centred in its container.
 *
 * Markers and badges are scaled down about their own centres: the source drew
 * them at roughly twice the weight they have in the design reference, where the
 * line reads as a hairline and the dots are small.
 */
const VIEW_BOX = '44 -42 273.8 125';

const STROKE_WIDTH = 1.4;

const MARKER_SCALE = 0.62;
const BADGE_SCALE = 0.82;

/** `translate(c) scale(s) translate(-c)` keeps a group centred while resizing. */
const scaleAbout = (cx: number, cy: number, scale: number) =>
  `translate(${cx}, ${cy}) scale(${scale}) translate(${-cx}, ${-cy})`;

const FIRST_MARKER_CENTER = { x: 101.45, y: 11.5 };
const SECOND_MARKER_CENTER = { x: 236.55, y: 25.8 };
const FIRST_BADGE_CENTER = { x: 138.7, y: -24.1 };
const SECOND_BADGE_CENTER = { x: 280.15, y: 17 };

export function MarketPathGraphic() {
  return (
    <Svg height="100%" preserveAspectRatio="xMidYMid meet" viewBox={VIEW_BOX} width="100%">
      <Defs>
        <RadialGradient
          id="firstMarker"
          cx="-961.8"
          cy="37.2"
          gradientTransform="matrix(6.878 0 0 6.878 6731 -257)"
          gradientUnits="userSpaceOnUse"
          r="1"
        >
          <Stop offset="0" stopColor={colors.textSecondary} />
          <Stop offset="1" stopColor={colors.textPrimary} />
        </RadialGradient>
        <RadialGradient
          id="secondMarker"
          cx="-978.6"
          cy="36.79"
          gradientTransform="matrix(6.615 -1.943 1.943 6.615 6555 -1980)"
          gradientUnits="userSpaceOnUse"
          r="1"
        >
          <Stop offset="0" stopColor={colors.textSecondary} />
          <Stop offset="1" stopColor={colors.textPrimary} />
        </RadialGradient>
      </Defs>

      <Path
        d="m48 54c7.2-11.4 21.4-36.2 32-41 8.6-3.9 15.1 0.3 17 2"
        fill="none"
        stroke={colors.textPrimary}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={STROKE_WIDTH}
      />
      <Path
        d="m101.5 15c6.1 4 4.6 24.5 8.5 37.5s13.1 15.4 24 9.5 19.7-28.2 32-31.5c8.2-2.2 15.3 1.5 15.5 11 0.2 6.4-3 13.4-4.5 23s5 14.5 11 14.5c18.1 0 28.3-25.2 38.5-39 10.1-13.6 17.3-13.7 30.5-16.5 15.1-3.2 24.5-10.5 34-23.5 6-8.3 15.7-24.2 20-32"
        fill="none"
        stroke={colors.textPrimary}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={STROKE_WIDTH}
      />
      <Path
        d="m297-30 15-4 1.8 13.2-2.6 0.3-1.4-10.1-12.1 3.1-0.7-2.5z"
        fill={colors.textPrimary}
      />

      <G
        transform={scaleAbout(FIRST_MARKER_CENTER.x, FIRST_MARKER_CENTER.y, MARKER_SCALE)}
      >
        <Path
          d="m91.6 12c0-5.4 4-10 9.5-10s10.2 4.2 9.9 9.6c-0.2 5-4 9.4-9.4 9.4-5.5 0-10-3.6-10-9z"
          fill={colors.textSecondary}
          fillOpacity={0.55}
        />
        <Path
          d="m92.5 11.6c0-4.6 3.5-8.6 8.6-8.6s9.5 3.6 9.2 8.4c-0.2 4.6-3.6 8.5-8.5 8.5-4.8 0-9.3-3.4-9.3-8.3z"
          fill={colors.textPrimary}
        />
        <Path
          d="m94.2 10.9c0-2.6 2.2-5.4 6.4-5.4s8.5 2.8 8.2 6.3c-0.2 2.6-2.1 5.6-6.5 5.6-3.9 0-8.1-2.3-8.1-6.5z"
          fill="url(#firstMarker)"
        />
        <Path
          d="m95.1 10.2c0-2.3 1.9-4.7 5.5-4.7s6.1 2.6 5.9 5.2c-0.2 2.1-2.1 4.4-5.5 4.4s-5.9-1.9-5.9-4.9z"
          fill={colors.textPrimary}
        />
      </G>

      <G
        transform={scaleAbout(SECOND_MARKER_CENTER.x, SECOND_MARKER_CENTER.y, MARKER_SCALE)}
      >
        <Path
          d="m227.3 28.1c-1.7-5.1 1.2-11.1 6.4-12.3s10.7 1.6 12.4 6.9c1.4 4.4-0.5 11.1-6.7 12.2-4.9 0.9-10.5-1.2-12.1-6.8z"
          fill={colors.textSecondary}
          fillOpacity={0.55}
        />
        <Path
          d="m228.5 27.8c-1.4-4.4 0.7-9.8 5.5-11.1 4.7-1.4 9.7 1.2 11.2 5.9 1.3 4.4-0.5 10.3-5.8 11.4-4.4 0.9-9.5-1.4-10.9-6.2z"
          fill={colors.textPrimary}
        />
        <Path
          d="m230.1 26.7c-0.7-2.3 0.2-5.9 4.1-7s8.5 0.9 9.4 4.2c0.7 2.5-0.2 6-3.7 6.9-3.8 1.4-8.6-0.2-9.8-4.1z"
          fill="url(#secondMarker)"
        />
        <Path
          d="m231.2 26c-0.7-2.1 0.3-4.9 3-5.6s5.7 0.9 6.6 3.5c0.7 2.1-0.2 4.9-3.3 5.6-2.5 0.6-5.3-0.7-6.3-3.5z"
          fill={colors.textPrimary}
        />
      </G>

      <G transform={scaleAbout(FIRST_BADGE_CENTER.x, FIRST_BADGE_CENTER.y, BADGE_SCALE)}>
        <Path
          d="m151.5-38h-24.5c-6.9 0-14.5 5.7-14.5 14.1v0.4c0 7.9 6.4 13.3 13.1 13.3h25c3.1 0 14.1-5.3 14.1-15.5 0.2-7.2-5.6-12.3-13.2-12.3z"
          fill={colors.accent}
        />
        <SvgText
          fill={colors.onAccent}
          fontSize={8.4}
          fontWeight="600"
          textAnchor="middle"
          x={FIRST_BADGE_CENTER.x}
          y={-21.3}
        >
          +3.28%
        </SvgText>
      </G>

      <G transform={scaleAbout(SECOND_BADGE_CENTER.x, SECOND_BADGE_CENTER.y, BADGE_SCALE)}>
        <Path
          d="m293 30.5h-27.5c-6.6 0-13.5-5.2-13.5-12.9v-0.7c0-6.9 5.6-13.4 13-13.4h28c4.4 0 14.5 2.8 15 12v2c0.3 6.9-5 13-13 13z"
          fill={colors.accent}
        />
        <SvgText
          fill={colors.onAccent}
          fontSize={8.4}
          fontWeight="600"
          textAnchor="middle"
          x={SECOND_BADGE_CENTER.x}
          y={19.8}
        >
          +12.76%
        </SvgText>
      </G>
    </Svg>
  );
}
