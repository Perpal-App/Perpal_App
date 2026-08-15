import { Children, Fragment, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { PressableScale } from '@/components/ui/PressableScale';
import {
  ProfileGlyph,
  type ProfileGlyphName,
} from '@/features/account/components/ProfileGlyph';
import { colors, radii, spacing, typography } from '@/theme/tokens';

/** Tile geometry, taken from iOS Settings: a 29pt rounded square with a continuous corner. */
const TILE_SIZE = 29;
const TILE_RADIUS = 7;

const CHEVRON_SIZE = 16;

/** Tint strength behind a state word. Matched to the balance card's rate pill. */
const PILL_TINT_OPACITY = 0.18;

export type StatePillTone = 'accent' | 'negative' | 'neutral' | 'positive';
export type SettingsTone = 'accent' | 'negative';

/**
 * A grouped run of settings rows: an inset rounded surface, a caps header above it, and
 * hairline separators between rows.
 *
 * The group owns the separators rather than each row declaring one, which is what keeps them
 * correct when a row is conditional — a row that renders as `null` is dropped by
 * `Children.toArray` before the separators are placed, so a hidden row never leaves a rule
 * behind or doubles one up. It also means the last row never carries a hairline against the
 * surface's own bottom edge.
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
 * One settings row: a tinted glyph tile, a label, and whatever the row carries on the right.
 *
 * `subtitle` puts a second line under the label, for a row whose value is too long to sit
 * beside it — an address. `value` is the right-aligned muted figure iOS uses for a version or a
 * count. `trailing` is for a node rather than text, currently the wallet state pill.
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
  onPress = null,
  subtitle,
  tone = 'default',
  trailing,
  value,
}: {
  readonly accessibilityHint?: string;
  /** Defaults to the visible label. Set it where the label alone would not orient a listener. */
  readonly accessibilityLabel?: string;
  readonly icon: ProfileGlyphName;
  readonly iconTone?: SettingsTone;
  readonly label: string;
  readonly onPress?: (() => void) | null;
  readonly subtitle?: ReactNode;
  readonly tone?: 'default' | 'destructive';
  readonly trailing?: ReactNode;
  readonly value?: string;
}) {
  const content = (
    <>
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[
          styles.tile,
          { backgroundColor: iconTone === 'negative' ? colors.negative : colors.accent },
        ]}
      >
        <ProfileGlyph name={icon} />
      </View>
      <View style={styles.body}>
        <View style={styles.headline}>
          <Text
            numberOfLines={1}
            style={[styles.label, tone === 'destructive' && styles.destructive]}
          >
            {label}
          </Text>
          {value === undefined ? null : (
            <Text numberOfLines={1} style={styles.value}>{value}</Text>
          )}
          {trailing}
          {onPress === null ? null : <Chevron />}
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
      // Barely any travel. A full-width row scaling by the app's usual 4% moves its edges
      // several points against the group's own edge, which reads as the surface flexing.
      pressedScale={0.99}
      onPress={onPress}
      style={styles.row}
    >
      {content}
    </PressableScale>
  );
}

/**
 * A state word in a tinted box.
 *
 * The word carries the state and the colour only agrees with it, so nothing is read from colour
 * alone. Same recipe as the balance card's rate pill: a separate tint layer rather than opacity
 * on the container, which would take the word down with it.
 */
export function StatePill({
  label,
  tone,
}: {
  readonly label: string;
  readonly tone: StatePillTone;
}) {
  const colour = PILL_TONES[tone];

  return (
    <View style={styles.pill}>
      <View style={[StyleSheet.absoluteFill, styles.pillTint, { backgroundColor: colour }]} />
      <Text style={[styles.pillLabel, { color: colour }]}>{label}</Text>
    </View>
  );
}

const PILL_TONES: Readonly<Record<StatePillTone, string>> = {
  accent: colors.accentSoft,
  negative: colors.negative,
  neutral: colors.textMuted,
  positive: colors.positive,
};

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
  // One surface for the whole group, clipped so the first and last rows take its corners. The
  // rows themselves carry no fill, which is what lets the separators between them read as rules
  // on one panel rather than as gaps between several.
  group: {
    overflow: 'hidden',
    borderRadius: radii.md,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  tile: {
    width: TILE_SIZE,
    height: TILE_SIZE,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: TILE_RADIUS,
    // A circular corner meets the straight edge at an abrupt change in curvature, which at this
    // size is what reads as a radius being slightly wrong; a continuous corner eases into it.
    borderCurve: 'continuous',
  },
  body: { flex: 1, minWidth: 0, gap: 2 },
  headline: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  label: { ...typography.bodyCompact, flex: 1, minWidth: 0, color: colors.textPrimary },
  value: { ...typography.bodyCompact, flexShrink: 0, color: colors.textMuted },
  destructive: { color: colors.negative },
  // Inset past the tile so it starts under the label, which is where iOS breaks a settings
  // list: a rule running the full width would cut the icons off from their own rows.
  separator: {
    marginLeft: spacing.sm + TILE_SIZE + spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  // Boxy and small: a capsule at this size would read as a button rather than as a state.
  pill: {
    flexShrink: 0,
    overflow: 'hidden',
    paddingHorizontal: spacing.xxs,
    paddingVertical: 1,
    borderRadius: radii.xs,
  },
  // Carries the corner itself as well as the parent's clip — an absolutely positioned child of
  // a rounded, clipped View is the case Android is least reliable about clipping.
  pillTint: { opacity: PILL_TINT_OPACITY, borderRadius: radii.xs },
  pillLabel: { ...typography.eyebrow, letterSpacing: 0 },
});
