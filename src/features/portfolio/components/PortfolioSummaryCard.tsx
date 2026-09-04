import { LinearGradient } from 'expo-linear-gradient';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { EyeIcon } from '@/assets/svg/EyeIcon';
import { SkeletonText } from '@/components/feedback/Skeleton';
import { PressableScale } from '@/components/ui/PressableScale';
import { RaisedChip } from '@/components/ui/RaisedChip';
import {
  money,
  percent,
  privateFunds,
  sumAmounts,
  unrealizedPnl,
  unrealizedRate,
  walletFunds,
} from '@/domain/portfolio/accountFigures';
import type { WalletBalances } from '@/features/account/hooks/useWalletBalances';
import { BalanceTiles } from '@/features/portfolio/components/BalanceTiles';
import {
  FundingActions,
  type FundingAction,
} from '@/features/portfolio/components/FundingActions';
import { PortfolioActivityRow } from '@/features/portfolio/components/PortfolioActivityRow';
import type { PacificaPortfolioSnapshot } from '@/integrations/perps/pacifica/pacificaPortfolio';
import { colors, fonts, gradients, radii, spacing, typography } from '@/theme/tokens';

/** Stands in for every figure while balances are hidden. */
const MASK = '••••••';
/** Invisible box around the eye. With `hitSlop` on top it clears the 48pt minimum target. */
const REVEAL_SIZE = 34;
/** Matched to the eye's box, so the two controls beside the label read as one cluster. */
const ASSETS_HEIGHT = 34;

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
  onViewAssets,
  portfolio,
}: {
  readonly balances: WalletBalances | null;
  readonly onAction: (action: FundingAction) => void;
  readonly onViewAssets: () => void;
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

        {/* Both controls ride the label's line rather than the figure's. Beside the figure they would
            have been competing with it for the same row: a balance in the tens of thousands is close
            to 200pt of display type, and `numberOfLines={1}` would have ellipsised the number to keep
            them — truncating the one thing the card exists to show. Up here the figure below gets the
            card's full width at any magnitude. */}
        <View style={styles.heroRow}>
          <Text style={styles.label}>Total balance</Text>

          <RaisedChip
            accessibilityHint="Opens public and private token balances"
            accessibilityLabel="View assets"
            contentStyle={styles.assetsContent}
            onPress={onViewAssets}
            style={styles.assets}
          >
            <Text maxFontSizeMultiplier={1.2} numberOfLines={1} style={styles.assetsText}>
              Assets
            </Text>
            <ChevronIcon />
          </RaisedChip>

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

        <BalanceTiles balances={balances} hidden={hidden} portfolio={portfolio} />

        <FundingActions onAction={onAction} />
      </LinearGradient>

      <PortfolioActivityRow hidden={hidden} portfolio={portfolio} />
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

function ChevronIcon() {
  return (
    <Svg height={13} viewBox="0 0 24 24" width={13}>
      <Path
        d="m9 6 6 6-6 6"
        fill="none"
        stroke={colors.textPrimary}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2.6}
      />
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
  heroRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  label: { ...typography.caption, flex: 1, minWidth: 0, color: colors.textSecondary },
  // Short of the 48pt minimum; `RaisedChip` carries the `hitSlop` that covers the rest. Sized to the
  // eye beside it so the two controls read as one cluster rather than as two unrelated affordances.
  assets: { height: ASSETS_HEIGHT, flexShrink: 0 },
  assetsContent: { paddingHorizontal: spacing.sm },
  assetsText: {
    ...typography.caption,
    fontFamily: fonts.semiBold,
    color: colors.textPrimary,
  },
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
});
