import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, Text, View } from 'react-native';

import {
  StatBadgeIcon,
  type StatBadgeName,
  type StatBadgeTone,
} from '@/assets/svg/StatBadgeIcon';
import { SkeletonText } from '@/components/feedback/Skeleton';
import {
  amountTone,
  percent,
  signedMoney,
  unrealizedPnl,
  unrealizedRate,
  type FigureTone,
} from '@/domain/portfolio/accountFigures';
import { ConcealedValue } from '@/features/portfolio/components/ConcealedValue';
import type { PacificaPortfolioSnapshot } from '@/integrations/perps/pacifica/pacificaPortfolio';
import { colors, gradients, radii, spacing, typography } from '@/theme/tokens';

const BADGE_SIZE = 34;

/** The tile takes the figure's own state, so badge and number can never disagree. */
const BADGE_TONES: Record<FigureTone, StatBadgeTone> = {
  negative: 'negative',
  plain: 'accent',
  positive: 'positive',
};

/**
 * Open trades and unrealized PnL, as two cards under the balance.
 *
 * They were two cells of a four-cell grid inside the balance card, which put "what is open" at the
 * same weight as "what I hold" and left the card carrying four unrelated figures. Out here they are
 * their own objects: activity, not balance.
 *
 * Cut from `surfaceRaise` and rimmed, deliberately not the violet the balance card uses — the ramp
 * is the app's treatment for chrome that frames a few discrete objects, and reusing the card's own
 * hue down here would read as one panel that had been split rather than as two new ones.
 */
export function PortfolioActivityRow({
  hidden,
  portfolio,
}: {
  readonly hidden: boolean;
  readonly portfolio: PacificaPortfolioSnapshot | null;
}) {
  const pnl = unrealizedPnl(portfolio);
  const rate = unrealizedRate(portfolio, pnl);

  return (
    <View style={styles.row}>
      {/* Not masked by the eye. A count of open positions is not a balance, and blanking it would
          cost the reader the one figure that says whether anything is running. */}
      <StatCard
        badge="trades"
        label="Active trades"
        value={portfolio === null ? null : String(portfolio.positions.length)}
      />
      <StatCard
        badge="pnl"
        caption={rate === null ? null : hidden ? '***' : percent(rate)}
        hidden={hidden}
        label="Unrealized PnL"
        tone={hidden ? 'plain' : amountTone(pnl)}
        value={signedMoney(pnl)}
      />
    </View>
  );
}

/**
 * One figure, stacked and centred.
 *
 * Centred rather than ranged left because there is one figure per card and nothing beneath it to
 * align a column against — off to one side it read as the first cell of a table that never arrived.
 * The badge sits on its own line above the label for the same reason: beside a label that wraps to
 * two lines, a centred row of icon-plus-text has no stable axis.
 */
function StatCard({
  badge,
  caption = null,
  hidden = false,
  label,
  tone = 'plain',
  value,
}: {
  readonly badge: StatBadgeName;
  /** The rate under the amount. Dropped rather than faked when there is no base to measure against. */
  readonly caption?: string | null;
  readonly hidden?: boolean;
  readonly label: string;
  readonly tone?: FigureTone;
  readonly value: string | null;
}) {
  return (
    <LinearGradient
      colors={gradients.surfaceRaise.colors}
      end={{ x: 0.5, y: 1 }}
      locations={gradients.surfaceRaise.locations}
      start={{ x: 0.5, y: 0 }}
      style={styles.card}
    >
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        pointerEvents="none"
      >
        <StatBadgeIcon name={badge} size={BADGE_SIZE} tone={BADGE_TONES[tone]} />
      </View>

      <Text maxFontSizeMultiplier={1.3} numberOfLines={2} style={styles.label}>
        {label}
      </Text>

      {value === null && !hidden ? (
        <SkeletonText role="heading" width={84} />
      ) : (
        <ConcealedValue
          hidden={hidden}
          numberOfLines={1}
          style={[
            styles.value,
            tone === 'positive' && styles.positive,
            tone === 'negative' && styles.negative,
          ]}
          value={value ?? '***'}
        />
      )}

      {/* Holds its line whether or not there is a rate, so the two cards stay the same height and
          the pair keeps reading as a pair. */}
      <Text numberOfLines={1} style={styles.caption}>
        {caption ?? ' '}
      </Text>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'stretch', gap: spacing.sm },
  // Clipped so the ramp takes the corners, and rimmed at a hairline: a full point here would
  // compete with the balance card's own edge directly above it.
  card: {
    flex: 1,
    minWidth: 0,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xxs,
    padding: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderCurve: 'continuous',
  },
  label: {
    ...typography.caption,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  value: {
    ...typography.heading,
    color: colors.textPrimary,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  caption: {
    ...typography.eyebrow,
    letterSpacing: 0,
    color: colors.textMuted,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  positive: { color: colors.positive },
  negative: { color: colors.negative },
});
