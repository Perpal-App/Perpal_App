import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { PressableScale } from '@/components/ui/PressableScale';
import { colors, layout, radii, spacing, typography } from '@/theme/tokens';

const CHEVRON_SIZE = 18;

/** Tint strength behind a state word. Matched to the balance card's rate pill. */
const PILL_TINT_OPACITY = 0.18;

export type StatePillTone = 'accent' | 'negative' | 'neutral' | 'positive';

/**
 * A titled run of profile rows.
 *
 * The title sits on the block rather than on a card, and the rows below carry the only rules
 * on screen — the same arrangement the market info list and the movers list use. `trailing`
 * is for a state that belongs to the whole block, not to one row in it.
 */
export function ProfileSection({
  children,
  title,
  trailing,
}: {
  readonly children: ReactNode;
  readonly title: string;
  readonly trailing?: ReactNode;
}) {
  return (
    <View>
      <View style={styles.sectionHeader}>
        <Text accessibilityRole="header" style={styles.sectionTitle}>{title}</Text>
        {trailing}
      </View>
      {children}
    </View>
  );
}

/**
 * One line on the profile screen.
 *
 * A line, not a card: a label, an optional value, a hairline under it, and nothing else. The
 * rows this replaced each carried a filled icon chip and a sentence of explanation, which made
 * a settings list of four items as tall as a screen and put the least important text in the
 * largest area. What a row does is in its label; the detail belongs in what the row opens.
 *
 * Without `onPress` it renders as a plain row and grows no chevron, so a value that cannot be
 * acted on never looks like it can.
 */
export function ProfileRow({
  accessibilityHint,
  accessibilityLabel,
  label,
  onPress = null,
  tone = 'default',
  trailing = null,
}: {
  readonly accessibilityHint?: string;
  /** Defaults to the visible label. Set it where the label is shortened by its section. */
  readonly accessibilityLabel?: string;
  readonly label: string;
  readonly onPress?: (() => void) | null;
  readonly tone?: 'default' | 'destructive';
  readonly trailing?: string | null;
}) {
  const content = (
    <>
      <Text
        numberOfLines={1}
        style={[styles.rowLabel, tone === 'destructive' && styles.destructive]}
      >
        {label}
      </Text>
      {trailing === null ? null : (
        <Text numberOfLines={1} style={styles.rowValue}>{trailing}</Text>
      )}
      {onPress === null ? null : <Chevron />}
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
      onPress={onPress}
      style={styles.row}
    >
      {content}
    </PressableScale>
  );
}

/**
 * A state word in a tinted box, beside the block it describes.
 *
 * The word carries the state and the colour only agrees with it, so nothing here is read from
 * colour alone. Same recipe as the balance card's rate pill: a separate tint layer rather than
 * opacity on the container, which would take the word down with it.
 */
export function StatePill({
  label,
  tone,
}: {
  readonly label: string;
  readonly tone: StatePillTone;
}) {
  const colour = TONES[tone];

  return (
    <View style={styles.pill}>
      <View style={[StyleSheet.absoluteFill, styles.pillTint, { backgroundColor: colour }]} />
      <Text style={[styles.pillLabel, { color: colour }]}>{label}</Text>
    </View>
  );
}

const TONES: Readonly<Record<StatePillTone, string>> = {
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
        strokeWidth={2}
      />
    </Svg>
  );
}

const styles = StyleSheet.create({
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginBottom: spacing.xxs,
  },
  // `textPrimary`, like the news and sentiment headings: a section title should not be the
  // dimmest thing in its own section.
  sectionTitle: { ...typography.label, flexShrink: 1, color: colors.textPrimary },
  row: {
    minHeight: layout.minTouchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowLabel: { ...typography.bodyCompact, flex: 1, minWidth: 0, color: colors.textPrimary },
  rowValue: { ...typography.caption, flexShrink: 0, color: colors.textMuted },
  destructive: { color: colors.negative },
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
