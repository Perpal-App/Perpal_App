import Svg, { Circle, Path } from 'react-native-svg';

import { colors } from '@/theme/tokens';

export const PROFILE_GLYPH_SIZE = 20;

export type ProfileGlyphName =
  | 'lock'
  | 'rotate'
  | 'shield'
  | 'signOut'
  | 'spark'
  | 'wallet';

/**
 * The stroked glyph that opens a profile row.
 *
 * Bare, on the page. The version this replaced sat each icon in a filled rounded square, which
 * put a second surface and a second radius on every row and made a list of four settings read
 * as a stack of tiles — the icon is a marker for the row, not an object in its own right.
 *
 * Drawn here rather than taken from an icon font, like every other glyph in the app: one stroke
 * weight, one cap style, and no dependency deciding what a wallet looks like. Every coordinate
 * is written out rather than relying on SVG's implicit number separators, which are legal but
 * not worth betting a glyph on.
 */
export function ProfileGlyph({
  name,
  tone = colors.textSecondary,
}: {
  readonly name: ProfileGlyphName;
  readonly tone?: string;
}) {
  return (
    <Svg height={PROFILE_GLYPH_SIZE} viewBox="0 0 24 24" width={PROFILE_GLYPH_SIZE}>
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
          <Circle cx="16.5" cy="12" fill={tone} r="1.1" />
        </>
      );
    // A crest with a keyhole: the derived wallet, held by this device.
    case 'shield':
      return (
        <>
          <Path {...stroke} d="M12 3.2 19 5.8v5.4c0 4.2 -2.8 7.3 -7 8.9 -4.2 -1.6 -7 -4.7 -7 -8.9V5.8Z" />
          <Circle {...stroke} cx="12" cy="10.8" r="1.9" />
          <Path {...stroke} d="M12 12.7v2.6" />
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
    // A padlock, shackle closed: the privacy boundary.
    case 'lock':
      return (
        <>
          <Path {...stroke} d="M7.6 10.5V8.6a4.4 4.4 0 0 1 8.8 0v1.9" />
          <Path
            {...stroke}
            d="M6.6 10.5h10.8a1.4 1.4 0 0 1 1.4 1.4v6.3a1.4 1.4 0 0 1 -1.4 1.4H6.6a1.4 1.4 0 0 1 -1.4 -1.4v-6.3a1.4 1.4 0 0 1 1.4 -1.4Z"
          />
        </>
      );
    // A door standing open, with the arrow leaving through it.
    case 'signOut':
      return (
        <>
          <Path {...stroke} d="M14 5.5H7.8A2.3 2.3 0 0 0 5.5 7.8v8.4A2.3 2.3 0 0 0 7.8 18.5H14" />
          <Path {...stroke} d="M11.6 12h8" />
          <Path {...stroke} d="M17.2 9.4 19.8 12l-2.6 2.6" />
        </>
      );
    // A four-point burst for experience. Filled, so a small mark still carries at row size.
    case 'spark':
      return (
        <Path
          d="M12 3.4 13.7 9.1 19.4 10.8 13.7 12.5 12 18.2 10.3 12.5 4.6 10.8 10.3 9.1Z"
          fill={tone}
        />
      );
  }
}
