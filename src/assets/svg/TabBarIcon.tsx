import type { ColorValue } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { colors } from '@/theme/tokens';

export type TabIconName = 'home' | 'trade' | 'portfolio' | 'account';

/** Matches the app's other SVG icons: 24x24 viewBox, rounded joins. */
const STROKE_WIDTH = 1.9;
/**
 * Strokes in the solid state are heavier, so a glyph built from a line still gains weight
 * when selected instead of having to invent a body to fill.
 */
const SOLID_STROKE_WIDTH = 2.7;

type Glyph = {
  /** Drawn as a stroke for the resting state. */
  readonly outline: string;
  /** Filled body of the solid state. Omitted where the solid form is a heavier stroke. */
  readonly solid?: string;
  /** Stroked part of the solid state, drawn at `SOLID_STROKE_WIDTH`. */
  readonly solidStroke?: string;
  /**
   * The solid body encloses a counter, so it needs the even-odd rule to cut the hole
   * rather than painting straight over it.
   */
  readonly solidHasHole?: boolean;
};

/**
 * Tab glyphs in two weights: an outline at rest and a solid when selected.
 *
 * Selection is carried by the glyph's own weight rather than by tint alone, which is what
 * makes the current tab obvious at a glance on a bar this small — a muted-to-white colour
 * change reads as a subtle highlight, a hollow shape becoming a solid one reads as a
 * state. Each pair traces the same silhouette so the two can be crossfaded in place and
 * the shape appears to thicken rather than swap.
 */
const glyphByName: Record<TabIconName, Glyph> = {
  // House with an open doorway. One silhouette serves both weights: stroked, the doorway
  // reads as an arch in the outline; filled, it stays a notch in the solid body.
  home: {
    outline:
      'M12 4.1 20.2 10.6V18.9a1.7 1.7 0 0 1-1.7 1.7h-3.9v-3.5Q14.6 15.2 12 15.2t-2.6 1.9v3.5H5.5a1.7 1.7 0 0 1-1.7-1.7v-8.3Z',
    // The peak is a short curve rather than a corner: the outline gets its rounded peak
    // free from `strokeLinejoin`, and a fill has no joins to round, so it has to be drawn.
    solid:
      'M11.1 4.1Q12 3.4 12.9 4.1L21 10.4V19a2 2 0 0 1-2 2h-4.5v-3.9Q14.5 15 12 15t-2.5 2.1V21H5a2 2 0 0 1-2-2v-8.6Z',
  },
  // Uptrend into a corner arrow. The solid weight thickens the line and fills the
  // arrowhead, rather than flooding the area beneath the line: at 21pt that fill swallowed
  // the line that gave the glyph its meaning and left an ambiguous block. The line runs
  // into the arrowhead so the two read as one mark.
  trade: {
    outline: 'M3.9 15.5 8.5 10.9l3 3 6.4-6.4M14.1 7.5h4.3v4.3',
    solid: 'M13.5 6.8h5.2v5.2Z',
    solidStroke: 'M4.1 15.6 8.6 11.1l3 3 5.2-5.2',
  },
  // Pie with one quarter called out: dividers as radii at rest, the quarter cut away when
  // solid. Both alternatives tried first failed for the same reason — they relied on a gap
  // a pill-sized glyph cannot show. Thin slots along the radii read as a clock face, and
  // offsetting the quarter to sit just outside the disc closed up into a plain circle.
  // Taking the quarter out entirely needs no gap to be legible at all.
  portfolio: {
    outline: 'M12 3.9a8.1 8.1 0 1 0 0 16.2 8.1 8.1 0 0 0 0-16.2ZM12 12V3.9M12 12h8.1',
    solid:
      'M12 3.6a8.4 8.4 0 1 0 0 16.8 8.4 8.4 0 0 0 0-16.8ZM12 12V3.6A8.4 8.4 0 0 1 20.4 12Z',
    solidHasHole: true,
  },
  // Head and shoulders. The outline leaves the shoulders as an open arc, which is lighter
  // than a closed U at this size; the solid closes them into a body.
  account: {
    outline: 'M12 11.6a3.6 3.6 0 1 0 0-7.2 3.6 3.6 0 0 0 0 7.2ZM5.2 20.2a6.8 6.8 0 0 1 13.6 0',
    solid:
      'M12 12a3.9 3.9 0 1 0 0-7.8 3.9 3.9 0 0 0 0 7.8ZM12 13.5c-4.1 0-7.4 2.7-7.4 6 0 .8.7 1.5 1.5 1.5h11.8c.8 0 1.5-.7 1.5-1.5 0-3.3-3.3-6-7.4-6Z',
  },
};

type TabBarIconProps = {
  readonly name: TabIconName;
  /** Both weights take a colour so the caller owns the tint. */
  readonly color?: ColorValue;
  /** Solid when the tab is selected, outline at rest. */
  readonly filled?: boolean;
  readonly size?: number;
};

export function TabBarIcon({
  name,
  color = colors.textMuted,
  filled = false,
  size = 24,
}: TabBarIconProps) {
  const glyph = glyphByName[name];

  if (!filled) {
    return (
      <Svg height={size} viewBox="0 0 24 24" width={size}>
        <Path
          d={glyph.outline}
          fill="none"
          stroke={color}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={STROKE_WIDTH}
        />
      </Svg>
    );
  }

  return (
    <Svg height={size} viewBox="0 0 24 24" width={size}>
      {glyph.solid === undefined ? null : (
        <Path
          d={glyph.solid}
          fill={color}
          fillRule={glyph.solidHasHole === true ? 'evenodd' : 'nonzero'}
        />
      )}
      {glyph.solidStroke === undefined ? null : (
        <Path
          d={glyph.solidStroke}
          fill="none"
          stroke={color}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={SOLID_STROKE_WIDTH}
        />
      )}
    </Svg>
  );
}
