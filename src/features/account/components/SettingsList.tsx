import Ionicons from '@expo/vector-icons/Ionicons';
import { Children, Fragment, type ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { PressableScale } from '@/components/ui/PressableScale';
import {
  ProfileGlyph,
  type ProfileGlyphName,
} from '@/features/account/components/ProfileGlyph';
import { colors, radii, spacing, typography } from '@/theme/tokens';

/**
 * Width reserved for the glyph.
 *
 * The 34pt gradient tile is gone. Three saturated violet squares down one panel were the loudest thing
 * on the screen, and they were competing with each other rather than with anything worth looking at —
 * a settings row's subject is its label and its value, and the mark is there to let the eye find the
 * row, not to decorate it.
 *
 * The slot is narrower than the tile was, so the label and the separator inset both move left with it
 * — a bare 22pt glyph floating in the middle of a 34pt box reads as a mark that lost its container.
 */
const GLYPH_SLOT = 26;

/**
 * Kept at the size the drawn chevron used, because the replacement occupies the same box.
 *
 * Ionicons' `chevron-forward` inks about 38% of its em width and 66% of its height at stroke 48/512;
 * the path this replaces inked 39% and 68% at stroke 2.4/24. Near enough that the row's right edge
 * does not move, and the weight now comes from the same font as every other glyph on the screen
 * rather than from a literal stroke width kept in agreement by hand.
 */
const CHEVRON_SIZE = 16;

/**
 * Ceiling on the OS text size for a row's headline.
 *
 * The row still scales with the reader's setting, but the label no longer shrinks to absorb overflow,
 * so an uncapped multiplier would put the cropping back — at 2x the label alone is wider than the
 * space between the glyph and the chevron, and being unshrinkable it would push the value out of the
 * row entirely rather than losing a few characters. Capped, the pair always has somewhere to go.
 *
 * Exported because an `accessory` has to scale on the same ceiling. A capped label beside an uncapped
 * value is worse than either extreme: the label holds still while the value grows, and since the
 * value is the side that yields, it shrinks itself away to make room for text that is not moving.
 */
export const SETTINGS_ROW_TEXT_SCALE = 1.25;

export type SettingsTone = 'accent' | 'negative';

/**
 * What colour a glyph takes.
 *
 * Two tones, and only one of them is a colour: a destructive row's mark is red because that is
 * information, and everything else matches the label beside it. Previously both were saturated
 * gradient fills, which spent the panel's entire colour budget on marks that all said "this is a
 * setting".
 *
 * Each tone is the exact colour of the text it opens — `textPrimary` against the label, `negative`
 * against a destructive one. At `textSecondary` the marks read as dull rather than as quiet, and the
 * reason is that a stroked glyph puts far less ink on the screen than a word does: Ionicons' outline
 * stroke is 32 of 512 em units, about 1.4pt at this size, which is roughly one stem of Poppins Medium
 * at 15. A mark carrying a fraction of the ink also has to carry the same value, or it looks switched
 * off next to its own label.
 */
const GLYPH_TONES = {
  accent: colors.textPrimary,
  negative: colors.negative,
} as const;

/**
 * A grouped run of settings rows: an inset rounded surface, a caps header above it, and hairline
 * separators between rows.
 *
 * The group owns the separators rather than each row declaring one, which is what keeps them
 * correct when a row is conditional — a row that renders as `null` is dropped by
 * `Children.toArray` before the separators are placed, so a hidden row never leaves a rule behind
 * or doubles one up. It also means the last row never carries a hairline against the surface's
 * own bottom edge.
 */
export function SettingsGroup({
  children,
  title,
}: {
  readonly children: ReactNode;
  readonly title: string;
}) {
  const rows = Children.toArray(children);

  return (
    <View>
      <Text accessibilityRole="header" style={styles.groupTitle}>{title}</Text>
      <View style={styles.group}>
        {rows.map((row, index) => (
          <Fragment key={index}>
            {index === 0 ? null : <View style={styles.separator} />}
            {row}
          </Fragment>
        ))}
      </View>
    </View>
  );
}

/**
 * One settings row: a glyph, a label, and one thing on the right.
 *
 * Every row is a single line now. The second line under the label is gone, and with it the only
 * thing it ever carried — a wallet address. A grouped list is read by running down the left edge and
 * glancing right, and a row that grows a second line breaks that scan twice: once by making itself
 * taller than its neighbours, and again by putting its value somewhere the eye is not looking.
 *
 * The right slot holds `accessory` if given, otherwise `value`. One or the other, never both: the
 * space beside a label is a single budget, and two things sharing it means each gets half of an
 * amount that was already the tight part of the row.
 *
 * Without `onPress` the row grows no chevron and takes no touches, so a value that cannot be
 * acted on never looks like it can.
 */
export function SettingsRow({
  accessibilityHint,
  accessibilityLabel,
  accessory,
  icon,
  iconTone = 'accent',
  label,
  loading = false,
  onPress = null,
  tone = 'default',
  value,
}: {
  readonly accessibilityHint?: string;
  /** Defaults to the visible label. Set it where the label alone would not orient a listener. */
  readonly accessibilityLabel?: string;
  /**
   * A node in the right slot, for a value that is more than text — an address with its copy
   * control, or a skeleton standing in for one. Displaces `value`.
   *
   * It has to shrink. The label does not, so whatever goes here is the side that absorbs a narrow
   * screen, and a node that holds its intrinsic width would push the label out of the row.
   */
  readonly accessory?: ReactNode;
  readonly icon: ProfileGlyphName;
  readonly iconTone?: SettingsTone;
  readonly label: string;
  readonly loading?: boolean;
  readonly onPress?: (() => void) | null;
  readonly tone?: 'default' | 'destructive';
  readonly value?: string;
}) {
  const content = (
    <>
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        pointerEvents="none"
        style={styles.glyph}
      >
        <ProfileGlyph name={icon} tone={GLYPH_TONES[iconTone]} />
      </View>
      <View style={styles.headline}>
        <Text
          maxFontSizeMultiplier={SETTINGS_ROW_TEXT_SCALE}
          numberOfLines={1}
          style={[styles.label, tone === 'destructive' && styles.destructive]}
        >
          {label}
        </Text>
        {accessory ?? (value === undefined ? null : (
          <Text
            maxFontSizeMultiplier={SETTINGS_ROW_TEXT_SCALE}
            numberOfLines={1}
            style={styles.value}
          >
            {value}
          </Text>
        ))}
        {loading ? (
          <ActivityIndicator
            color={tone === 'destructive' ? colors.negative : colors.accent}
            size="small"
          />
        ) : onPress === null ? null : (
          <Ionicons
            color={colors.textMuted}
            name="chevron-forward"
            size={CHEVRON_SIZE}
          />
        )}
      </View>
    </>
  );

  if (onPress === null) {
    return <View style={styles.row}>{content}</View>;
  }

  return (
    <PressableScale
      accessibilityHint={accessibilityHint}
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityRole="button"
      accessibilityState={{ busy: loading, disabled: loading }}
      disabled={loading}
      onPress={onPress}
      // Barely any travel. A full-width row scaling by the app's usual 4% moves its edges several
      // points against the group's own edge, which reads as the surface flexing.
      pressedScale={0.99}
      style={styles.row}
    >
      {content}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  groupTitle: {
    ...typography.eyebrow,
    marginBottom: spacing.xs,
    paddingHorizontal: spacing.xs,
    color: colors.textMuted,
  },
  // One surface for the whole group, clipped so the first and last rows take its corners. The rows
  // themselves carry no fill, which is what lets the separators between them read as rules on one
  // panel rather than as gaps between several.
  group: {
    overflow: 'hidden',
    borderRadius: radii.md,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surfaceTinted,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  glyph: {
    width: GLYPH_SLOT,
    flexShrink: 0,
    alignItems: 'center',
  },
  // One view, where there used to be two. The outer `body` existed only to stack a headline above a
  // subtitle, and with the subtitle gone it was a column wrapping a single row — a level of nesting
  // per row, on every row, holding nothing.
  //
  // `minWidth: 0` is what lets the accessory inside actually shrink. A flex item defaults to a minimum
  // of its content's width, so without this the row would size itself to the full address and hand the
  // overflow to the screen rather than to the ellipsis.
  headline: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  // Grows to fill when the row carries nothing on the right, so a lone label still pushes the chevron
  // to the edge. Does not shrink, which is the more important half: the label had `flex: 1` and the
  // value `flexShrink: 0`, so whenever the two together overran the row the label absorbed the whole
  // deficit and "Email support" came out as "Email supp…". The row's own name is the last thing on it
  // that should be sacrificed for space, and now that the address sits beside it rather than under it
  // that rule is doing real work on every wallet row.
  //
  // `rowLabel` — Medium 15, the role added for exactly this. It has been Regular 14 (lighter than the
  // address it shares the row with, so the value outweighed its own heading) and then SemiBold 14
  // (heavier than everything, so the whole column shouted). Medium 15 is the one that reads as a list:
  // lighter than SemiBold, larger than either, and still a step above the value beside it.
  label: {
    ...typography.rowLabel,
    flexGrow: 1,
    flexShrink: 0,
    minWidth: 0,
    color: colors.textPrimary,
  },
  // `caption`, a step under the label rather than level with it.
  //
  // At `bodyCompact` the muted value was set at the label's own size and weight, so a 20-character
  // string like perpal.app@gmail.com claimed as much of the row as the thing it was qualifying —
  // measured against the bundled Poppins, 147pt of a 210pt budget on a 360pt screen. 12pt returns
  // about 18pt of that and restores the hierarchy the two should have had.
  //
  // `flexShrink: 1` makes it the side that gives way. On a narrow device the value ellipsises instead
  // of the label, which is the right trade — the row's accessibility label still carries it in full.
  // An `accessory` shrinks the same way, by its own styles rather than these.
  value: {
    ...typography.caption,
    flexShrink: 1,
    minWidth: 0,
    color: colors.textMuted,
    textAlign: 'right',
  },
  destructive: { color: colors.negative },
  // Inset past the glyph so it starts under the label, which is where iOS breaks a settings list: a
  // rule running the full width would cut the icons off from their own rows. Derived from the slot, so
  // it followed the tile's removal on its own.
  separator: {
    marginLeft: spacing.sm + GLYPH_SLOT + spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
});
