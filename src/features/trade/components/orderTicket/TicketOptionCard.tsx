import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { PressableScale } from '@/components/ui/PressableScale';
import { TicketPanel } from '@/features/trade/components/orderTicket/TicketPanel';
import { colors, radii, spacing, typography } from '@/theme/tokens';

type IoniconName = ComponentProps<typeof Ionicons>['name'];

const BADGE = 36;
const GLYPH = 18;
const CHEVRON = 16;

/**
 * Ceiling on the OS text size inside a card. It still scales, but a title, a subtitle and a value share
 * one line's width, and uncapped at 2x the value is pushed out of the card entirely.
 */
const TEXT_SCALE = 1.3;

/**
 * One of the ticket's options: a glyph, what it is, what it is currently doing, and a way in.
 *
 * The subtitle is the point of the card. A row that only named the setting would make the reader open
 * it to learn its state; this says the state — the margin mode behind a leverage figure, the prices an
 * auto close will act on — so the ticket can be read top to bottom without a tap.
 *
 * The whole card is the target, and it opens a page, which is what the chevron says.
 */
export function TicketOptionCard({
  accessibilityHint,
  icon,
  onPress,
  subtitle,
  title,
  value,
}: {
  readonly accessibilityHint: string;
  readonly icon: IoniconName;
  readonly onPress: () => void;
  readonly subtitle: string;
  readonly title: string;
  readonly value?: string;
}) {
  return (
    <PressableScale
      accessibilityHint={accessibilityHint}
      accessibilityLabel={[title, value, subtitle].filter(Boolean).join(', ')}
      accessibilityRole="button"
      onPress={onPress}
      // Barely any travel: a full-width card scaling by the app's usual 4% moves its edges several points
      // against the column, and reads as the surface flexing.
      pressedScale={0.985}
    >
      <TicketPanel style={styles.card}>
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={styles.badge}
        >
          <Ionicons color={colors.textPrimary} name={icon} size={GLYPH} />
        </View>
        <View style={styles.copy}>
          <Text maxFontSizeMultiplier={TEXT_SCALE} numberOfLines={1} style={styles.title}>{title}</Text>
          <Text maxFontSizeMultiplier={TEXT_SCALE} numberOfLines={1} style={styles.subtitle}>
            {subtitle}
          </Text>
        </View>
        {value === undefined ? null : (
          <Text maxFontSizeMultiplier={TEXT_SCALE} numberOfLines={1} style={styles.value}>{value}</Text>
        )}
        <Ionicons color={colors.textMuted} name="chevron-forward" size={CHEVRON} />
      </TicketPanel>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  card: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  // Recessed into the card rather than raised off it: the page's darkest tone inside a hairline, the
  // same well the reference layout sets its marks in, cut from this app's palette.
  badge: {
    width: BADGE,
    height: BADGE,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radii.pill,
    backgroundColor: colors.background,
  },
  // `flex: 1` so the copy owns the leftover width and the value sits hard against the chevron.
  copy: { flex: 1, minWidth: 0, gap: 1 },
  title: { ...typography.rowLabel, color: colors.textPrimary },
  subtitle: { ...typography.caption, color: colors.textMuted },
  value: { ...typography.label, flexShrink: 0, color: colors.textPrimary },
});
