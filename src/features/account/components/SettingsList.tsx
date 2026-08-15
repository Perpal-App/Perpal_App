import { LinearGradient } from 'expo-linear-gradient';
import { Children, Fragment, type ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { PressableScale } from '@/components/ui/PressableScale';
import {
  ProfileGlyph,
  type ProfileGlyphName,
} from '@/features/account/components/ProfileGlyph';
import { colors, gradients, radii, spacing, typography } from '@/theme/tokens';

/**
 * Tile size.
 *
 * Up from the 29 iOS uses, because these rows are not iOS's: a wallet row carries a label over an
 * address, so the tile is centred against two lines rather than one and at 29 it read as a small mark
 * floating beside a taller block. 34 is a little over half the two-line block's height, which is the
 * proportion that makes it read as the row's own mark rather than as decoration on it.
 */
const TILE_SIZE = 34;

/**
 * Tile corner, held at the order buttons' proportion rather than their exact value.
 *
 * Those are 42pt tall on `radii.sm`, a touch under a quarter of their height. The same token on a tile
 * this size would be closer to a third, which starts to read as a pill; 9 keeps the ratio, so the tile
 * and the buy button look like the same material cut to different sizes.
 */
const TILE_RADIUS = 9;

const CHEVRON_SIZE = 16;

export type SettingsTone = 'accent' | 'negative';

/**
 * The material a tile is cut from.
 *
 * The same recipe as the order buttons: a ramp from a lit top edge to a deeper base, rimmed one
 * step darker on all four sides. That is what gives a small square its dimension — the fill reads
 * as a curved surface catching light rather than as a flat block of colour, which is what the
 * solid violet squares this replaced looked like.
 *
 * Destructive rows take the app's red action material, the same one the sell button uses. There
 * is one red action material, not two: a second red gradient a shade off this one would be a
 * palette with a bug in it.
 *
 * Left to infer rather than annotated, deliberately: `LinearGradient` wants its stops as tuples of
 * at least two entries, and widening them to `readonly string[]` on the way through a record type
 * is enough to lose that and fail the call.
 */
const TILE_MATERIALS = {
  accent: { edge: colors.accentEdge, ramp: gradients.accentAction },
  negative: { edge: colors.shortEdge, ramp: gradients.shortAction },
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
  const material = TILE_MATERIALS[iconTone];
  const content = (
    <>
      <LinearGradient
        accessibilityElementsHidden
        colors={material.ramp.colors}
        end={{ x: 0.5, y: 1 }}
        importantForAccessibility="no-hide-descendants"
        locations={material.ramp.locations}
        start={{ x: 0.5, y: 0 }}
        style={[styles.tile, { borderColor: material.edge }]}
      >
        <ProfileGlyph name={icon} />
      </LinearGradient>
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
  // Clipped, so the ramp takes the tile's corners, and rimmed at a full point rather than a
  // hairline — the same weight the order buttons carry, which is what makes the edge read as the
  // side of a raised surface instead of an outline drawn around it.
  tile: {
    width: TILE_SIZE,
    height: TILE_SIZE,
    flexShrink: 0,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: TILE_RADIUS,
    borderCurve: 'continuous',
  },
  body: { flex: 1, minWidth: 0, gap: 2 },
  headline: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  label: { ...typography.bodyCompact, flex: 1, minWidth: 0, color: colors.textPrimary },
  value: { ...typography.bodyCompact, flexShrink: 0, color: colors.textMuted },
  destructive: { color: colors.negative },
  // Inset past the tile so it starts under the label, which is where iOS breaks a settings list: a
  // rule running the full width would cut the icons off from their own rows.
  separator: {
    marginLeft: spacing.sm + TILE_SIZE + spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
});
