import FontAwesome6 from '@expo/vector-icons/FontAwesome6';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps } from 'react';

import { colors } from '@/theme/tokens';

/**
 * Glyph size in a settings row.
 *
 * A point up from the drawn set it replaces. Ionicons sits on a 512-unit grid with its own optical
 * padding, so the same nominal size renders very slightly smaller than a path drawn edge to edge on a
 * 24-unit box.
 */
export const PROFILE_GLYPH_SIZE = 23;

export type ProfileGlyphName =
  | 'info'
  | 'mail'
  | 'rotate'
  | 'shield'
  | 'signOut'
  | 'wallet'
  | 'x';

/**
 * Ionicons, outline variants throughout.
 *
 * Chosen over Feather and Material for the reason the reference asks for: Ionicons is the rounded
 * family of the three — round caps, round joins, and circular bowls — where Feather is geometric and
 * Material is squared. Outline only, so nothing in this set carries a fill.
 *
 * `shield-checkmark-outline` rather than a bare shield: this row is the wallet the device derived and
 * verified, and the check is the part that says verified.
 */
/**
 * Typed off the component rather than as `string`, so a renamed or misspelled glyph is a compile
 * error here instead of an empty square on the screen at runtime.
 */
type IoniconName = ComponentProps<typeof Ionicons>['name'];

const IONICONS: Readonly<Record<Exclude<ProfileGlyphName, 'x'>, IoniconName>> = {
  info: 'information-circle-outline',
  mail: 'mail-outline',
  rotate: 'refresh-outline',
  shield: 'shield-checkmark-outline',
  signOut: 'log-out-outline',
  wallet: 'wallet-outline',
};

/**
 * The glyph opening a settings row.
 *
 * Every mark here used to be a hand-plotted SVG path — seven of them, with their own stroke weight,
 * cap style and optical centring to keep in agreement, and two that quietly mixed a filled disc into
 * an otherwise stroked set. That is a lot of bespoke drawing to maintain for glyphs every icon family
 * already ships, and it is why they never quite matched each other.
 *
 * `@expo/vector-icons` is font-backed rather than SVG, so these are glyphs in a typeface: one grid,
 * one optical weight, and no per-path coordinates in this repo at all.
 *
 * X is the exception and has to be. It is a brand mark, not an interface icon, so it comes from
 * FontAwesome6's brands set — Ionicons still ships the pre-rebrand bird, which would be wrong.
 */
export function ProfileGlyph({
  name,
  size = PROFILE_GLYPH_SIZE,
  tone = colors.textPrimary,
}: {
  readonly name: ProfileGlyphName;
  readonly size?: number;
  readonly tone?: string;
}) {
  if (name === 'x') {
    // Slightly smaller: a brand glyph fills its em box edge to edge where an outline icon carries
    // padding, so matched nominally it would read as the largest mark in the column.
    return (
      <FontAwesome6
        color={tone}
        iconStyle="brand"
        name="x-twitter"
        size={Math.round(size * 0.86)}
      />
    );
  }

  return <Ionicons color={tone} name={IONICONS[name]} size={size} />;
}
