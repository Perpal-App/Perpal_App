import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { SkeletonText } from '@/components/feedback/Skeleton';
import { PressableScale } from '@/components/ui/PressableScale';
import {
  addAmounts,
  amountFromBaseUnits,
  formatDetailedUsd,
  parseAmount,
  subtractAmounts,
  type Amount,
} from '@/domain/money/amount';
import type { WalletBalances } from '@/features/account/hooks/useWalletBalances';
import type { PacificaPortfolioSnapshot } from '@/integrations/perps/pacifica/pacificaPortfolio';
import type { VelocityAccountSnapshot } from '@/integrations/perps/velocity/velocityAccount';
import { colors, radii, spacing, typography } from '@/theme/tokens';

/** Stands in for every figure while balances are hidden. */
const MASK = '••••••';
const EYE_SIZE = 22;
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
  balancesPending,
  onActivate,
  portfolio,
  portfolioPending,
  velocity,
  velocityPending,
}: {
  readonly activationRequired?: boolean;
  readonly balances: WalletBalances | null;
  readonly balancesPending: boolean;
  readonly onActivate?: () => void;
  readonly portfolio: PacificaPortfolioSnapshot | null;
  readonly portfolioPending: boolean;
  readonly velocity: VelocityAccountSnapshot | null;
  readonly velocityPending: boolean;
}) {
  // Session-scoped on purpose: this exists for the moment someone is standing behind you, not as a
  // setting. Persisting it belongs in AppPreferences, and would need to be a deliberate choice
  // rather than a side effect of one tap.
  const [hidden, setHidden] = useState(false);

  const publicBalance = walletFunds(balances?.publicWallet ?? null);
  const privateBalance = privateFunds(balances, portfolio, velocity);
  const total = sum(publicBalance, privateBalance);
  const pnl = unrealizedPnl(portfolio, velocity);
  const pnlRate = unrealizedRate(portfolio, velocity, pnl);
  const totalPending = balancesPending || portfolioPending || velocityPending;

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

          {activationRequired && onActivate !== undefined ? (
            <PressableScale
              accessibilityHint="Creates or restores private wallet T"
              accessibilityLabel="Activate private trading"
              accessibilityRole="button"
              onPress={onActivate}
              style={styles.activate}
            >
              <Text style={styles.activateLabel}>Activate</Text>
            </PressableScale>
          ) : totalPending && total === null ? (
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
              {hidden ? MASK : money(total) ?? 'Unavailable'}
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
          pending={balancesPending}
          value={money(publicBalance)}
        />
        <Part
          hidden={hidden}
          label={walletLabel('Private funds', balances?.privateWallet ?? null)}
          pending={balancesPending || portfolioPending || velocityPending}
          value={money(privateBalance)}
        />
        <Part
          label="Active trades"
          pending={portfolioPending || velocityPending}
          value={portfolio === null || velocity === null
            ? null
            : String(portfolio.positions.length + velocity.positions.length)}
        />
        <Part
          hidden={hidden}
          label="PnL"
          pending={portfolioPending || velocityPending}
          tone={pnl === null || pnl.baseUnits === 0n ? 'plain' : pnl.baseUnits > 0n ? 'positive' : 'negative'}
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
  pending,
  tone = 'plain',
  value,
}: {
  readonly hidden?: boolean;
  readonly label: string;
  readonly pending: boolean;
  readonly tone?: 'positive' | 'negative' | 'plain';
  readonly value: string | null;
}) {
  return (
    <View style={styles.part}>
      <Text style={styles.partLabel}>{label}</Text>
      {pending && value === null ? (
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
          {hidden ? MASK : value ?? 'Unavailable'}
        </Text>
      )}
    </View>
  );
}

/**
 * A rounded eye: an almond outline, a filled pupil, and a stroke across both when hidden.
 *
 * The outline is two mirrored cubics rather than the flatter quadratic lens it replaced, opened
 * taller so the shape reads as a rounded eye rather than as a slit. Round caps and joins take the
 * hard point off the two corners where the curves meet.
 */
function EyeIcon({ hidden }: { readonly hidden: boolean }) {
  return (
    <Svg height={EYE_SIZE} viewBox="0 0 24 24" width={EYE_SIZE}>
      <Path
        d="M3 12C7 6 17 6 21 12C17 18 7 18 3 12Z"
        fill="none"
        stroke={colors.textSecondary}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.7}
      />
      {/* Filled, not stroked. A ring this small collapses into a smudge, while a solid pupil stays
          a pupil — and it gives the glyph one weighted point, which is what keeps an outline of
          this size from reading as an empty shape. */}
      <Path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" fill={colors.textSecondary} />
      {hidden ? (
        <Path
          d="M4.4 19.6 19.6 4.4"
          fill="none"
          stroke={colors.textSecondary}
          strokeLinecap="round"
          strokeWidth={1.7}
        />
      ) : null}
    </Svg>
  );
}

function walletFunds(
  wallet: WalletBalances['publicWallet'] | null,
): Amount | null {
  return wallet?.valuation === null || wallet === null
    ? null
    : amountFromBaseUnits(wallet.valuation.usdBaseUnits, 6);
}

function privateFunds(
  balances: WalletBalances | null,
  portfolio: PacificaPortfolioSnapshot | null,
  velocity: VelocityAccountSnapshot | null,
): Amount | null {
  if (balances === null || portfolio === null || velocity === null) return null;

  const wallet = walletFunds(balances.privateWallet);
  if (wallet === null) return null;

  try {
    return addAmounts(
      addAmounts(wallet, parseAmount(portfolio.accountEquity, 6)),
      amountFromBaseUnits(velocity.equityBaseUnits, 6),
    );
  } catch {
    return null;
  }
}

function walletLabel(
  label: string,
  wallet: WalletBalances['publicWallet'] | null,
): string {
  const count = wallet?.valuation?.unpricedAssetCount ?? 0;
  return count === 0 ? label : `${label} · ${count} unpriced`;
}

function unrealizedPnl(
  portfolio: PacificaPortfolioSnapshot | null,
  velocity: VelocityAccountSnapshot | null,
): Amount | null {
  if (portfolio === null || velocity === null) return null;

  try {
    return addAmounts(
      subtractAmounts(parseAmount(portfolio.accountEquity, 6), parseAmount(portfolio.balance, 6)),
      amountFromBaseUnits(velocity.unrealizedPnlBaseUnits, 6),
    );
  } catch {
    return null;
  }
}

/**
 * The move as basis points of the deposited balance it was earned on.
 *
 * Integer maths on base units throughout: converting to a float first to divide would put rounding
 * error into a figure the reader will compare against the amount beside it.
 */
function unrealizedRate(
  portfolio: PacificaPortfolioSnapshot | null,
  velocity: VelocityAccountSnapshot | null,
  pnl: Amount | null,
): number | null {
  if (portfolio === null || velocity === null || pnl === null) return null;

  try {
    const base = addAmounts(
      parseAmount(portfolio.balance, 6),
      amountFromBaseUnits(
        velocity.equityBaseUnits - velocity.unrealizedPnlBaseUnits,
        6,
      ),
    );
    if (base.baseUnits === 0n) return null;

    return Number((pnl.baseUnits * 10_000n) / base.baseUnits);
  } catch {
    return null;
  }
}

/** Null unless both parts are known: a total missing one of its halves is a wrong number. */
function sum(left: Amount | null, right: Amount | null): Amount | null {
  if (left === null || right === null) return null;

  try {
    return addAmounts(left, right);
  } catch {
    return null;
  }
}

function money(value: Amount | null): string | null {
  return value === null ? null : formatDetailedUsd(value);
}

function signedMoney(value: Amount | null): string | null {
  const formatted = money(value);
  return formatted === null || value === null || value.baseUnits <= 0n
    ? formatted
    : `+${formatted}`;
}

function percent(basisPoints: number): string {
  const absolute = Math.abs(basisPoints);
  const sign = basisPoints > 0 ? '+' : basisPoints < 0 ? '-' : '';
  return `${sign}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, '0')}%`;
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
  activate: {
    minHeight: typography.display.lineHeight,
    alignSelf: 'flex-start',
    justifyContent: 'center',
  },
  activateLabel: { ...typography.title, color: colors.accentSoft },
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
