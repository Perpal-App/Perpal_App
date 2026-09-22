import Svg, { Circle, Path } from 'react-native-svg';

import { colors } from '@/theme/tokens';

/**
 * Glyph size in a settings row.
 *
 * Up from 20, because there is no longer a tile behind it. It was sized as an inlay — a little over
 * half a 34pt gradient square — and a mark that had a saturated block to sit on needs more of its own
 * presence once the block is gone.
 */
export const PROFILE_GLYPH_SIZE = 22;

export type ProfileGlyphName =
  | 'info'
  | 'mail'
  | 'rotate'
  | 'shield'
  | 'signOut'
  | 'wallet'
  | 'x';

/**
 * The glyph opening a settings row.
 *
 * Drawn here rather than taken from an icon font, like every other glyph in the app: one stroke
 * weight, one cap style, and no dependency deciding what a wallet looks like. Every coordinate is
 * written out rather than relying on SVG's implicit number separators, which are legal but not
 * worth betting a glyph on.
 *
 * Outline only — no filled shape anywhere in the set. Two of these carried one filled disc each, a
 * clasp and a tittle, which is the detail that makes a stroked icon look assembled rather than drawn.
 * Both are now round-capped strokes.
 *
 * Back to the app's 1.7 weight from the 1.9 these used. The heavier stroke existed to hold up against
 * a saturated tile; on the page it just made these the boldest marks in the app.
 *
 * Defaults to `textSecondary`. These name their rows, they do not advertise them, and the row's own
 * label is the thing meant to lead.
 */
export function ProfileGlyph({
  name,
  size = PROFILE_GLYPH_SIZE,
  tone = colors.textSecondary,
}: {
  readonly name: ProfileGlyphName;
  readonly size?: number;
  readonly tone?: string;
}) {
  return (
    <Svg height={size} viewBox="0 0 24 24" width={size}>
      {paths(name, tone)}
    </Svg>
  );
}

/**
 * A dot, drawn as a stroke.
 *
 * A hair of vertical travel with a round cap renders as a disc of the stroke's own width — so the
 * wallet's clasp and the info glyph's tittle stay part of the outline instead of being the one filled
 * shape in an otherwise stroked set. Written as real travel rather than zero-length, which some
 * renderers decline to paint at all.
 */
function dot(x: number, y: number): string {
  return `M${x} ${y}v0.2`;
}

function paths(name: ProfileGlyphName, tone: string) {
  const stroke = {
    fill: 'none',
    stroke: tone,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    strokeWidth: 1.7,
  } as const;

  switch (name) {
    // A billfold with its clasp on the right edge.
    case 'wallet':
      return (
        <>
          <Path
            {...stroke}
            d="M3.5 8.5A2.5 2.5 0 0 1 6 6h12A2.5 2.5 0 0 1 20.5 8.5v7A2.5 2.5 0 0 1 18 18H6a2.5 2.5 0 0 1 -2.5 -2.5Z"
          />
          <Path {...stroke} d={dot(16.4, 11.9)} />
        </>
      );
    // A crest with a keyhole: the wallet this device derived and holds.
    case 'shield':
      return (
        <>
          <Path {...stroke} d="M12 3.2 19 5.8v5.4c0 4.2 -2.8 7.3 -7 8.9 -4.2 -1.6 -7 -4.7 -7 -8.9V5.8Z" />
          <Circle {...stroke} cx="12" cy="10.6" r="1.9" />
          <Path {...stroke} d="M12 12.5v2.6" />
        </>
      );
    // Three quarters of a circle with a head on the open end.
    case 'rotate':
      return (
        <>
          <Path {...stroke} d="M19.5 12a7.5 7.5 0 1 1 -2.6 -5.7" />
          <Path {...stroke} d="M19.8 3.6v3.4h-3.4" />
        </>
      );
    // An envelope, flap down. The flap is a separate stroke so it reads as a fold rather than as
    // a triangle sitting inside a box.
    case 'mail':
      return (
        <>
          <Path
            {...stroke}
            d="M3.5 8A2.5 2.5 0 0 1 6 5.5h12A2.5 2.5 0 0 1 20.5 8v8a2.5 2.5 0 0 1 -2.5 2.5H6A2.5 2.5 0 0 1 3.5 16Z"
          />
          <Path {...stroke} d="M4.4 7.6 12 13.1 19.6 7.6" />
        </>
      );
    // The X mark: two flat-ended bands, the heavier weight and butt caps of the platform's own
    // logo rather than the app's rounded stroke, so it does not read as a dismiss control.
    case 'x':
      return (
        <>
          <Path
            d="M5.2 4.2 18.9 19.8"
            fill="none"
            stroke={tone}
            strokeLinecap="butt"
            strokeWidth={2.5}
          />
          <Path
            d="M18.9 4.2 5.2 19.8"
            fill="none"
            stroke={tone}
            strokeLinecap="butt"
            strokeWidth={2.5}
          />
        </>
      );
    // A ringed lowercase i. The dot is filled, so it survives at this size.
    case 'info':
      return (
        <>
          <Circle {...stroke} cx="12" cy="12" r="8.2" />
          <Path {...stroke} d="M12 11.4v5" />
          <Path {...stroke} d={dot(12, 8.1)} />
        </>
      );
    // A door standing open, with the arrow leaving through it.
    case 'signOut':
      return (
        <>
          <Path {...stroke} d="M13.6 5.5H7.8A2.3 2.3 0 0 0 5.5 7.8v8.4A2.3 2.3 0 0 0 7.8 18.5h5.8" />
          <Path {...stroke} d="M11.4 12h8.1" />
          <Path {...stroke} d="M17 9.5 19.5 12 17 14.5" />
        </>
      );
  }
}
