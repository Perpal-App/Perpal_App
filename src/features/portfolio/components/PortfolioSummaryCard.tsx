import { LinearGradient } from 'expo-linear-gradient';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { EyeIcon } from '@/assets/svg/EyeIcon';
import { SkeletonText } from '@/components/feedback/Skeleton';
import { PressableScale } from '@/components/ui/PressableScale';
import {
  money,
  percent,
  privateFunds,
  sumAmounts,
  unrealizedPnl,
  unrealizedRate,
  walletFunds,
  walletLabel,
} from '@/domain/portfolio/accountFigures';
import type { WalletBalances } from '@/features/account/hooks/useWalletBalances';
import {
  FundingActions,
  type FundingAction,
} from '@/features/portfolio/components/FundingActions';
import { PortfolioActivityRow } from '@/features/portfolio/components/PortfolioActivityRow';
import type { PacificaPortfolioSnapshot } from '@/integrations/perps/pacifica/pacificaPortfolio';
import { colors, gradients, radii, spacing, typography } from '@/theme/tokens';

/** Stands in for every figure while balances are hidden. */
const MASK = '••••••';
/** Invisible box around the eye. With `hitSlop` on top it clears the 48pt minimum target. */
const REVEAL_SIZE = 34;

/**
 * The balance, what it is made of, and what to do with it.
 *
 * This owns its own hero rather than embedding `AccountOverviewCard` the way it used to. The two
 * layouts have diverged — home wants a quiet four-cell grid under the figure, this wants a lit panel
 * with the activity split out below it — and one component serving both would have meant a flag per
 * difference. The figures themselves stay shared, in `domain/portfolio/accountFigures`, so the two
 * screens cannot drift on what a balance is.
 *
 * `hidden` lives here because it has to cover the activity cards too. Leaving it inside the hero
 * would have masked the balance while the unrealized PnL sat in the open underneath, which defeats
 * most of what the eye is for.
 */
export function PortfolioSummaryCard({
  balances,
  onAction,
  portfolio,
}: {
  readonly balances: WalletBalances | null;
  readonly onAction: (action: FundingAction) => void;
  readonly portfolio: PacificaPortfolioSnapshot | null;
}) {
  // Session-scoped on purpose: this exists for the moment someone is standing behind you, not as a
  // setting. Persisting it would belong in preferences and be a deliberate choice, not one tap.
  const [hidden, setHidden] = useState(false);

  const publicBalance = walletFunds(balances?.publicWallet ?? null);
  const privateBalance = privateFunds(balances, portfolio);
  const total = sumAmounts(publicBalance, privateBalance);
  const rate = unrealizedRate(portfolio, unrealizedPnl(portfolio));

  return (
    <View style={styles.stack}>
      <LinearGradient
        colors={gradients.profilePanel.colors}
        end={{ x: 1, y: 1 }}
        locations={gradients.profilePanel.locations}
        start={{ x: 0, y: 0 }}
        style={styles.card}
      >
        <LinearGradient
          colors={gradients.cardSheen.colors}
          end={{ x: 0.5, y: 1 }}
          locations={gradients.cardSheen.locations}
          pointerEvents="none"
          start={{ x: 0.5, y: 0 }}
          style={StyleSheet.absoluteFill}
        />

        <View style={styles.heroRow}>
          <View style={styles.heroCopy}>
            <Text style={styles.label}>Total balance</Text>

            <View style={styles.valueRow}>
              {total === null ? (
                <View style={styles.heroPending}>
                  <SkeletonText role="display" width={188} />
                </View>
              ) : (
                <Text
                  accessibilityLiveRegion="polite"
                  numberOfLines={1}
                  selectable={!hidden}
                  style={styles.hero}
                >
                  {hidden ? MASK : money(total)}
                </Text>
              )}
              <TrendPill hidden={hidden} value={rate} />
            </View>
          </View>

          <PressableScale
            accessibilityHint="Hides every balance on this screen until tapped again"
            accessibilityLabel={hidden ? 'Show balances' : 'Hide balances'}
            accessibilityRole="button"
            accessibilityState={{ checked: hidden }}
            hitSlop={12}
            onPress={() => setHidden((value) => !value)}
            style={styles.reveal}
          >
            <EyeIcon hidden={hidden} />
          </PressableScale>
        </View>

        {/* Two capsules rather than one panel split by a rule. The panel was the uneven part: a single
            flat translucent fill stretched across the card's diagonal ramp, so it read lighter at its
            top-left corner than at its bottom-right — the wider the fill, the more of the gradient it
            had to sit still against. Two narrower capsules on the denser `glassRaised` each cover far
            less of that sweep, and the material is now the same one the actions below use, so the card
            holds two kinds of pill instead of a box above a row of pills. */}
        <View style={styles.funds}>
          <Figure
            hidden={hidden}
            label={walletLabel('Public funds', balances?.publicWallet ?? null)}
            value={money(publicBalance)}
          />
          <Figure
            hidden={hidden}
            label={walletLabel('Private funds', balances?.privateWallet ?? null)}
            value={money(privateBalance)}
          />
        </View>

        <FundingActions onAction={onAction} />
      </LinearGradient>

      <PortfolioActivityRow hidden={hidden} portfolio={portfolio} />
    </View>
  );
}

/** One of the two balances the total is made of. */
function Figure({
  hidden,
  label,
  value,
}: {
  readonly hidden: boolean;
  readonly label: string;
  readonly value: string | null;
}) {
  return (
    <View style={styles.figure}>
      <Text maxFontSizeMultiplier={1.3} numberOfLines={2} style={styles.figureLabel}>
        {label}
      </Text>
      {value === null ? (
        <SkeletonText role="label" width={64} />
      ) : (
        <Text numberOfLines={1} selectable={!hidden} style={styles.figureValue}>
          {hidden ? MASK : value}
        </Text>
      )}
    </View>
  );
}

/**
 * The unrealized move as a rate, in a tinted capsule beside the figure.
 *
 * Dropped rather than faked when there is no deposited balance to measure against, and dropped while
 * balances are hidden — a rate discloses how the balance is doing, which is most of what hiding it
 * was for. The amount behind this rate is on the PnL card below, so neither figure is shown twice.
 */
function TrendPill({
  hidden,
  value,
}: {
  readonly hidden: boolean;
  readonly value: number | null;
}) {
  if (value === null || hidden) return null;

  const flat = value === 0;
  const down = value < 0;
  const tint = flat ? colors.textMuted : down ? colors.negative : colors.positive;

  return (
    <View style={styles.pill}>
      {/* The tint is a layer, not opacity on the capsule: dimming the container would take the
          percentage down with it and leave the text unreadable. */}
      <View style={[StyleSheet.absoluteFill, styles.pillTint, { backgroundColor: tint }]} />
      {flat ? null : <TrendArrow color={tint} down={down} />}
      <Text maxFontSizeMultiplier={1.2} style={[styles.pillText, { color: tint }]}>
        {percent(value)}
      </Text>
    </View>
  );
}

function TrendArrow({ color, down }: { readonly color: string; readonly down: boolean }) {
  return (
    <Svg height={10} viewBox="0 0 12 12" width={10}>
      <Path d={down ? 'M6 10 1.5 3h9L6 10Z' : 'M6 2l4.5 7h-9L6 2Z'} fill={color} />
    </Svg>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.sm },
  card: {
    overflow: 'hidden',
    gap: spacing.md,
    padding: spacing.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassEdge,
    borderRadius: radii.lg,
    borderCurve: 'continuous',
  },
  heroRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  heroCopy: { flex: 1, minWidth: 0, gap: 2 },
  label: { ...typography.caption, color: colors.textSecondary },
  valueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  // The currency sits at the figure's own size and weight. A smaller muted symbol reads as an
  // annotation on the number rather than as part of it.
  hero: {
    ...typography.display,
    color: colors.textPrimary,
    fontVariant: ['tabular-nums'],
  },
  // Holds the figure's line so the row below does not shift when the number lands.
  heroPending: { height: typography.display.lineHeight, justifyContent: 'center' },
  reveal: {
    width: REVEAL_SIZE,
    height: REVEAL_SIZE,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Capsule, not the boxy pill on the home grid: at this size beside a display figure it is an
  // attached badge rather than a competing control.
  pill: {
    overflow: 'hidden',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.xs,
    paddingVertical: 3,
    borderRadius: radii.pill,
  },
  // Carries the corner itself as well as the parent's clip — an absolutely positioned child of a
  // rounded, clipped View is the case Android is least reliable about clipping.
  pillTint: { opacity: 0.18, borderRadius: radii.pill },
  pillText: { ...typography.caption, fontVariant: ['tabular-nums'] },
  // Same gap as the action row below, so the two rows of capsules share one rhythm.
  funds: { flexDirection: 'row', alignItems: 'stretch', gap: spacing.xs },
  // The actions' material and radius, at figure proportions: `spacing.md` of horizontal inset rather
  // than `spacing.xs`, because a capsule this tall has a ~30pt corner and text ranged to the edge
  // would run into the curve.
  figure: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.pill,
    backgroundColor: colors.glassRaised,
  },
  figureLabel: {
    ...typography.caption,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  figureValue: {
    ...typography.label,
    color: colors.textPrimary,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
});
