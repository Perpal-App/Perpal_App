import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { EyeIcon } from '@/assets/svg/EyeIcon';
import { SkeletonText } from '@/components/feedback/Skeleton';
import { PressableScale } from '@/components/ui/PressableScale';
import {
  amountTone,
  money,
  percent,
  privateFunds,
  signedMoney,
  sumAmounts,
  unrealizedPnl,
  unrealizedRate,
  walletFunds,
  walletLabel,
} from '@/domain/portfolio/accountFigures';
import type { WalletBalances } from '@/features/account/hooks/useWalletBalances';
import type { PacificaPortfolioSnapshot } from '@/integrations/perps/pacifica/pacificaPortfolio';
import { colors, radii, spacing, typography } from '@/theme/tokens';

/** Stands in for every figure while balances are hidden. */
const MASK = '••••••';
/** Invisible box around the eye. With `hitSlop` on top it clears the 48pt minimum target. */
const REVEAL_SIZE = 34;

/**
 * What the account is worth.
 *
 * One combined figure leads: the public wallet and the private side added together, because that
 * is the number someone opens the app to see, and leaving them to add two balances themselves was
 * the previous version's real failure. The move against that combined figure rides the heading as
 * a rate, where it qualifies the label rather than competing with the figure.
 *
 * The parts follow underneath, one step down: the two balances the total is made of and the count
 * of positions open against them. They are the answer to "where is it", which is a different
 * question from "how much is there" and belongs below it, not beside it.
 *
 * Deliberately not a card. No border, no fill, no material — the screen's gradient is the surface.
 * Hierarchy here is size and spacing, which is all it needs.
 */
export function AccountOverviewCard({
  activationRequired = false,
  balances,
  onActivate,
  portfolio,
}: {
  readonly activationRequired?: boolean;
  readonly balances: WalletBalances | null;
  readonly onActivate?: () => void;
  readonly portfolio: PacificaPortfolioSnapshot | null;
}) {
  // Session-scoped on purpose: this exists for the moment someone is standing behind you, not as a
  // setting. Persisting it belongs in AppPreferences, and would need to be a deliberate choice
  // rather than a side effect of one tap.
  const [hidden, setHidden] = useState(false);

  const publicBalance = walletFunds(balances?.publicWallet ?? null);
  const privateBalance = privateFunds(balances, portfolio);
  const total = sumAmounts(publicBalance, privateBalance);
  const pnl = unrealizedPnl(portfolio);
  const pnlRate = unrealizedRate(portfolio, pnl);

  if (activationRequired && onActivate !== undefined) {
    return (
      <View style={styles.activation}>
        <Text style={styles.activationTitle}>Activate private trading</Text>
        <Text style={styles.activationMessage}>
          Create or restore private trading to hold private funds and sign on this device.
        </Text>
        <PressableScale
          accessibilityHint="Creates or restores private trading"
          accessibilityLabel="Activate private trading"
          accessibilityRole="button"
          onPress={onActivate}
          style={styles.activate}
        >
          <Text style={styles.activateLabel}>Activate private trading</Text>
        </PressableScale>
      </View>
    );
  }

  return (
    <View style={styles.block}>
      <View style={styles.heroRow}>
        <View style={styles.heroCopy}>
          {/* The rate rides the label rather than sitting under the figure. Below it, the move's
              amount was a second currency figure directly beneath the first and read as a
              competing balance — at rest, when both were zero, as a duplicate of it. Up here it
              qualifies the heading, which is what a rate does. */}
          <View style={styles.labelRow}>
            <Text style={styles.label}>Total balance</Text>
            <Rate hidden={hidden} value={pnlRate} />
          </View>

          {total === null ? (
            <View style={styles.heroPending}>
              <SkeletonText role="display" width={196} />
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
        </View>

        {/* No disc behind it. A control that only ever does one reversible thing does not need a
            frame to be found, and the frame was the same glass as the two discs in the header
            above — which made a minor toggle look like a third piece of primary chrome. The
            target it needs is bought with padding and hit slop instead. */}
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

      <View style={styles.parts}>
        <Part
          hidden={hidden}
          label={walletLabel('Public funds', balances?.publicWallet ?? null)}
          value={money(publicBalance)}
        />
        <Part
          hidden={hidden}
          label={walletLabel('Private funds', balances?.privateWallet ?? null)}
          value={money(privateBalance)}
        />
        <Part
          label="Active trades"
          value={portfolio === null ? null : String(portfolio.positions.length)}
        />
        <Part
          hidden={hidden}
          label="PnL"
          tone={amountTone(pnl)}
          value={signedMoney(pnl)}
        />
      </View>
    </View>
  );
}

/**
 * The unrealized move as a rate, in a tinted pill beside the heading.
 *
 * A rate needs a base to be a rate, so it is dropped rather than faked when the account has no
 * deposited balance to measure against — a percentage off zero is either infinity or a lie. Absent
 * is also the right state while balances are hidden: a rate discloses how the balance is doing,
 * which is most of what hiding it was for.
 */
function Rate({ hidden, value }: { readonly hidden: boolean; readonly value: number | null }) {
  if (value === null || hidden) return null;

  const flat = value === 0;
  const down = value < 0;

  return (
    <View style={styles.pill}>
      {/* The tint is a layer, not opacity on the pill: dimming the container would take the
          percentage down with it and leave the text unreadable. */}
      <View
        style={[
          StyleSheet.absoluteFill,
          styles.pillTint,
          { backgroundColor: flat ? colors.border : down ? colors.negative : colors.positive },
        ]}
      />
      <Text style={[styles.pillText, flat ? null : down ? styles.negative : styles.positive]}>
        {percent(value)}
      </Text>
    </View>
  );
}

/** One of the balances the total is made of, or what is open against them. */
function Part({
  hidden = false,
  label,
  tone = 'plain',
  value,
}: {
  readonly hidden?: boolean;
  readonly label: string;
  readonly tone?: 'positive' | 'negative' | 'plain';
  readonly value: string | null;
}) {
  return (
    <View style={styles.part}>
      <Text style={styles.partLabel}>{label}</Text>
      {value === null ? (
        <SkeletonText role="label" width={56} />
      ) : (
        <Text
          numberOfLines={1}
          selectable={!hidden}
          style={[
            styles.partValue,
            tone === 'positive' && styles.positive,
            tone === 'negative' && styles.negative,
          ]}
        >
          {hidden ? MASK : value}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: spacing.md },
  heroRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  heroCopy: { flex: 1, minWidth: 0, gap: 2 },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  // `textSecondary`, not `textMuted`. These name the figures under them, and against a violet
  // gradient rather than the near-black page they were judged on, muted grey lost too much of its
  // contrast to be read at caption size.
  label: { ...typography.caption, color: colors.textSecondary },
  // The currency sits at the figure's own size and weight. A smaller muted symbol was tried and
  // reads as an annotation on the number rather than as part of it.
  hero: {
    ...typography.display,
    color: colors.textPrimary,
    fontVariant: ['tabular-nums'],
  },
  // Holds the figure's line so the move below does not shift when the number lands.
  heroPending: { height: typography.display.lineHeight, justifyContent: 'center' },
  activation: { gap: spacing.xs },
  activationTitle: { ...typography.label, color: colors.textPrimary },
  activationMessage: { ...typography.bodyCompact, color: colors.textSecondary },
  activate: {
    minHeight: 44,
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.md,
    justifyContent: 'center',
    borderRadius: radii.sm,
    backgroundColor: colors.accent,
  },
  activateLabel: { ...typography.label, color: colors.onAccent },
  // Boxy, and small: a capsule at this size would read as a button rather than as a figure's unit.
  pill: {
    overflow: 'hidden',
    paddingHorizontal: spacing.xxs,
    paddingVertical: 1,
    borderRadius: radii.xs,
  },
  // Carries the corner itself as well as the parent's clip — an absolutely positioned child of a
  // rounded, clipped View is the case Android is least reliable about clipping.
  pillTint: { opacity: 0.18, borderRadius: radii.xs },
  pillText: { ...typography.eyebrow, letterSpacing: 0, color: colors.textSecondary },
  reveal: {
    width: REVEAL_SIZE,
    height: REVEAL_SIZE,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  parts: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg },
  part: { flexBasis: '42%', flexGrow: 1, minWidth: 0, gap: 2 },
  partLabel: { ...typography.caption, color: colors.textSecondary },
  partValue: {
    ...typography.label,
    color: colors.textPrimary,
    fontVariant: ['tabular-nums'],
  },
  positive: { color: colors.positive },
  negative: { color: colors.negative },
});
