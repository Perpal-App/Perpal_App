import { LinearGradient } from 'expo-linear-gradient';
import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { PnlTrendIcon, TradesIcon } from '@/assets/svg/ActivityStatIcons';
import { SkeletonText } from '@/components/feedback/Skeleton';
import { ConcealedValue } from '@/features/portfolio/components/ConcealedValue';
import {
  amountTone,
  percent,
  signedMoney,
  unrealizedPnl,
  unrealizedRate,
  type FigureTone,
} from '@/domain/portfolio/accountFigures';
import type { PacificaPortfolioSnapshot } from '@/integrations/perps/pacifica/pacificaPortfolio';
import { colors, gradients, radii, spacing, typography } from '@/theme/tokens';

/** Tracks the icons' own size, so the slot never crops the glyph it holds. */
const MARK_SIZE = 28;

/**
 * The footprint these cards had when their content was stacked, held across every rearrangement since.
 *
 * Spelled out from the tokens that produced it rather than pinned to a number, so it stays honest if
 * the scale moves: inset, a label line, the mark, a figure line, the rate line, and three gaps between
 * them. The current arrangement measures shorter than this — mark and title share one line, and the
 * figure block is two — so the minimum is what binds, and `space-between` spends the surplus by
 * pushing the figure to the base instead of trailing a void under it.
 *
 * Recomputing this from the *current* layout would defeat it. The point is that the pair keeps the size
 * it had, so it stays in proportion with the holdings tiles above.
 *
 * With the mark at 28 and the figure at `title`, the content now measures past this on its own, so it
 * acts as a floor rather than as the binding height — kept for the case where a figure or the rate line
 * goes missing and the card would otherwise collapse under its neighbour.
 */
const CARD_MIN_HEIGHT =
  spacing.md * 2 +
  typography.caption.lineHeight +
  MARK_SIZE +
  typography.label.lineHeight +
  typography.eyebrow.lineHeight +
  spacing.xs * 3;

/** The arrow's direction is information; its colour is not. The figure below carries the tone. */
const TREND: Record<FigureTone, 'down' | 'flat' | 'up'> = {
  negative: 'down',
  plain: 'flat',
  positive: 'up',
};

/**
 * Open trades and unrealized PnL, as two cards under the balance.
 *
 * Laid out to the holdings tiles inside the card above: label, then the mark, then the figure, all
 * ranged left, on the same `spacing.md` inset and `spacing.xs` rhythm, at `radii.lg` so all three
 * radii in this stack agree. They were centred around a filled badge, which made them a different kind
 * of object from the tiles they sit under despite showing the same kind of thing.
 *
 * The surface stays `surfaceRaise` with a hairline rim rather than the card's violet wash: these are
 * out on the page, so they need their own edge, where a tile inside the card borrows the card's.
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
  const tone = amountTone(pnl);

  return (
    <View style={styles.row}>
      {/* Not masked by the eye. A count of open positions is not a balance, and blanking it would cost
          the reader the one figure that says whether anything is running. */}
      <StatCard
        icon={<TradesIcon />}
        label="Active trades"
        value={portfolio === null ? null : String(portfolio.positions.length)}
      />
      <StatCard
        caption={rate === null || hidden ? null : percent(rate)}
        hidden={hidden}
        icon={<PnlTrendIcon direction={TREND[tone]} />}
        label="Unrealized PnL"
        tone={tone}
        value={signedMoney(pnl)}
      />
    </View>
  );
}

function StatCard({
  caption = null,
  hidden = false,
  icon,
  label,
  tone = 'plain',
  value,
}: {
  /** The rate under the amount. Dropped rather than faked when there is no base to measure against. */
  readonly caption?: string | null;
  readonly hidden?: boolean;
  readonly icon: ReactNode;
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
      <View style={styles.head}>
        <Text maxFontSizeMultiplier={1.3} numberOfLines={2} style={styles.label}>
          {label}
        </Text>

        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          pointerEvents="none"
          style={styles.mark}
        >
          {icon}
        </View>
      </View>

      <View style={styles.figure}>
        {value === null && !hidden ? (
          <SkeletonText align="right" role="title" width={96} />
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
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'stretch', gap: spacing.xs },
  // The holdings tiles' geometry — same inset, same gap, same corner — on the page's own material.
  // Clipped so the ramp takes the corner, and rimmed at a hairline rather than a full point: these sit
  // beside each other, and a heavier edge on both would read as two outlines before two surfaces.
  card: {
    minHeight: CARD_MIN_HEIGHT,
    flex: 1,
    minWidth: 0,
    overflow: 'hidden',
    justifyContent: 'space-between',
    gap: spacing.xs,
    padding: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radii.lg,
    borderCurve: 'continuous',
  },
  // Title over its mark, both ranged left. A column rather than a row so the label gets the card's
  // full width and "Unrealized PnL" is not forced to wrap beside a 28pt glyph.
  head: { gap: spacing.xs },
  mark: {
    width: MARK_SIZE,
    height: MARK_SIZE,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { ...typography.caption, color: colors.textSecondary },
  // Ranged right and pinned to the base by the card's `space-between`, so the figure lands in the
  // corner diagonally opposite its mark. The two read as one block, which is why the rate sits inside
  // this rather than on the card.
  //
  // Held off the right edge by half a step more than the card's own inset. Flush against it, a bold
  // 26pt figure sat closer to the edge than the label does on the other side — optically tighter than
  // the same measurement reads at caption size, because the heavier the type the more its mass carries
  // to the boundary.
  figure: { alignItems: 'flex-end', gap: 2, paddingRight: spacing.xs },
  // `title`, well above the holdings tiles' `label`. These cards carry a single figure with nothing
  // competing beside it, where a tile has to leave room for a row of logos over its own.
  value: {
    ...typography.title,
    color: colors.textPrimary,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  caption: {
    ...typography.eyebrow,
    letterSpacing: 0,
    color: colors.textMuted,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  positive: { color: colors.positive },
  negative: { color: colors.negative },
});
