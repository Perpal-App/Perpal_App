import Svg, { Circle, Path } from 'react-native-svg';

import { colors } from '@/theme/tokens';

/**
 * Glyph size inside a settings tile.
 *
 * A little over half the tile, which is the proportion iOS uses: any larger and the mark crowds
 * the rounded square it sits in, any smaller and the tile reads as empty.
 */
export const PROFILE_GLYPH_SIZE = 17;

export type ProfileGlyphName =
  | 'info'
  | 'mail'
  | 'rotate'
  | 'shield'
  | 'signOut'
  | 'wallet'
  | 'x';

/**
 * The glyph inside a settings row's tile.
 *
 * Drawn here rather than taken from an icon font, like every other glyph in the app: one stroke
 * weight, one cap style, and no dependency deciding what a wallet looks like. Every coordinate is
 * written out rather than relying on SVG's implicit number separators, which are legal but not
 * worth betting a glyph on.
 *
 * Stroked at 1.9 rather than the 1.7 used elsewhere, because these sit on a saturated tile at
 * 17pt: a hairline mark on colour reads thinner than the same mark on the page.
 */
export function ProfileGlyph({
  name,
  size = PROFILE_GLYPH_SIZE,
  tone = colors.onAccent,
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

function paths(name: ProfileGlyphName, tone: string) {
  const stroke = {
    fill: 'none',
    stroke: tone,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    strokeWidth: 1.9,
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
          <Circle cx="16.4" cy="12" fill={tone} r="1.2" />
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
          <Path {...stroke} d="M12 11.2v5" />
          <Circle cx="12" cy="8.2" fill={tone} r="1.1" />
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
