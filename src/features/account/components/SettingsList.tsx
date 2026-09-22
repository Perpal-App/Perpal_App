import { Children, Fragment, type ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

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

const CHEVRON_SIZE = 16;

/**
 * Ceiling on the OS text size for a row's headline.
 *
 * The row still scales with the reader's setting, but the label no longer shrinks to absorb overflow,
 * so an uncapped multiplier would put the cropping back — at 2x the label alone is wider than the
 * space between the tile and the chevron, and being unshrinkable it would push the value out of the
 * row entirely rather than losing a few characters. Capped, the pair always has somewhere to go.
 */
const MAX_TEXT_SCALE = 1.25;

export type SettingsTone = 'accent' | 'negative';

/**
 * What colour a glyph takes.
 *
 * Two tones, and only one of them is a colour: a destructive row's mark is red because that is
 * information, and everything else is the same quiet grey. Previously both were saturated gradient
 * fills, which spent the panel's entire colour budget on marks that all said "this is a setting".
 */
const GLYPH_TONES = {
  accent: colors.textSecondary,
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
 * One settings row: a glyph tile, a label, and whatever the row carries on the right.
 *
 * `subtitle` puts a second line under the label, for a value too long to sit beside it — an
 * address. `value` is the right-aligned muted text iOS uses for a version, a handle, or a state.
 *
 * Without `onPress` the row grows no chevron and takes no touches, so a value that cannot be
 * acted on never looks like it can.
 */
export function SettingsRow({
  accessibilityHint,
  accessibilityLabel,
  icon,
  iconTone = 'accent',
  label,
  loading = false,
  onPress = null,
  subtitle,
  tone = 'default',
  value,
}: {
  readonly accessibilityHint?: string;
  /** Defaults to the visible label. Set it where the label alone would not orient a listener. */
  readonly accessibilityLabel?: string;
  readonly icon: ProfileGlyphName;
  readonly iconTone?: SettingsTone;
  readonly label: string;
  readonly loading?: boolean;
  readonly onPress?: (() => void) | null;
  readonly subtitle?: ReactNode;
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
      <View style={styles.body}>
        <View style={styles.headline}>
          <Text
            maxFontSizeMultiplier={MAX_TEXT_SCALE}
            numberOfLines={1}
            style={[styles.label, tone === 'destructive' && styles.destructive]}
          >
            {label}
          </Text>
          {value === undefined ? null : (
            <Text
              maxFontSizeMultiplier={MAX_TEXT_SCALE}
              numberOfLines={1}
              style={styles.value}
            >
              {value}
            </Text>
          )}
          {loading ? (
            <ActivityIndicator
              color={tone === 'destructive' ? colors.negative : colors.accent}
              size="small"
            />
          ) : onPress === null ? null : (
            <Chevron />
          )}
        </View>
        {subtitle}
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

/** Stroked rather than a text glyph, so its weight matches the app's other drawn icons. */
function Chevron() {
  return (
    <Svg height={CHEVRON_SIZE} viewBox="0 0 24 24" width={CHEVRON_SIZE}>
      <Path
        d="M9 5l7 7-7 7"
        fill="none"
        stroke={colors.textMuted}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2.4}
      />
    </Svg>
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
  body: { flex: 1, minWidth: 0, gap: 2 },
  headline: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  // Grows to fill when the row carries no value, so a lone label still pushes the chevron to the
  // right edge. Does not shrink, which is the half that was missing: the label had `flex: 1` and the
  // value `flexShrink: 0`, so whenever the two together overran the row the label absorbed the whole
  // deficit and "Email support" came out as "Email supp…". The row's own name is the last thing on it
  // that should be sacrificed for space.
  // `label`, not `bodyCompact`. Both are 14pt, but `bodyCompact` is Regular and the address beneath it
  // borrows `eyebrow`'s SemiBold — so a row's heading was set lighter than its own value, and the eye
  // went to the base58 before the word telling it which wallet it belonged to. SemiBold here and Medium
  // below restores the order without changing either size.
  label: {
    ...typography.label,
    flexGrow: 1,
    flexShrink: 0,
    minWidth: 0,
    color: colors.textPrimary,
  },
  // `caption`, a step under the label rather than level with it.
  //
  // At `bodyCompact` the muted detail was set at the label's own size and weight, so a 20-character
  // address like perpal.app@gmail.com claimed as much of the row as the thing it was qualifying —
  // about 140pt of a 210pt budget on a 360pt screen. 12pt returns roughly 18pt of that and restores
  // the hierarchy the two should have had: this line describes the row, it does not title it.
  //
  // `flexShrink: 1` makes it the side that gives way now. On a narrow device the address ellipsises
  // instead of the label, which is the right trade — the full value is still in the row's
  // accessibility label, and tapping the row acts on it either way.
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
