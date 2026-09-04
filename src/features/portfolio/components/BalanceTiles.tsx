import { StyleSheet, Text, View } from 'react-native';

import { SkeletonText } from '@/components/feedback/Skeleton';
import { readAppConfig } from '@/config/appConfig';
import {
  money,
  privateFunds,
  walletFunds,
  walletLabel,
} from '@/domain/portfolio/accountFigures';
import type {
  WalletBalance,
  WalletBalances,
} from '@/features/account/hooks/useWalletBalances';
import { ConcealedValue } from '@/features/portfolio/components/ConcealedValue';
import { TokenLogo } from '@/features/portfolio/components/TokenLogo';
import { listWalletTokens } from '@/features/portfolio/components/withdrawalAssets';
import { listTradingCollateralOptions } from '@/integrations/perps/providerCollateral';
import type { PacificaPortfolioSnapshot } from '@/integrations/perps/pacifica/pacificaPortfolio';
import type { TokenMetadataMap } from '@/integrations/solana/tokenMetadata';
import { colors, radii, spacing, typography } from '@/theme/tokens';

/** Maximum number of overlapping RPC-sourced marks that fit a half-width summary tile. */
const MAX_LOGOS = 4;
const EMPTY_METADATA: TokenMetadataMap = new Map();

/**
 * What each side of the balance holds, as two tiles.
 *
 * The tiles carry `glassHighlight`, not the accent ramp the funding chips use. These are figures, not
 * actions, and cutting them from the same material as the buttons below would say they could be
 * pressed.
 *
 * Token marks are rendered only when the metadata RPC returns an image for that mint.
 */
export function BalanceTiles({
  balances,
  hidden,
  portfolio,
}: {
  readonly balances: WalletBalances | null;
  readonly hidden: boolean;
  readonly portfolio: PacificaPortfolioSnapshot | null;
}) {
  const config = readAppConfig();
  // Configured mints, not a literal list: this is the same source the withdraw panels resolve
  // symbols from, so a token named here is named identically there.
  const configured = config.ok
    ? listTradingCollateralOptions(config.value.perps.usdcMint, config.value.perps.usdtMint)
    : [];

  return (
    <View style={styles.row}>
      <Tile
        configured={configured}
        hidden={hidden}
        label={walletLabel('Public funds', balances?.publicWallet ?? null)}
        metadata={balances?.tokenMetadata ?? EMPTY_METADATA}
        value={money(walletFunds(balances?.publicWallet ?? null))}
        wallet={balances?.publicWallet ?? null}
      />
      <Tile
        additionalMints={
          config.ok && portfolio !== null && !zero(portfolio.accountEquity)
            ? [config.value.perps.usdcMint]
            : []
        }
        configured={configured}
        hidden={hidden}
        label={walletLabel('Private funds', balances?.privateWallet ?? null)}
        metadata={balances?.tokenMetadata ?? EMPTY_METADATA}
        value={money(privateFunds(balances, portfolio))}
        wallet={balances?.privateWallet ?? null}
      />
    </View>
  );
}

function Tile({
  additionalMints = [],
  configured,
  hidden,
  label,
  metadata,
  value,
  wallet,
}: {
  readonly additionalMints?: readonly string[];
  readonly configured: readonly { readonly mint: string; readonly symbol: string }[];
  readonly hidden: boolean;
  readonly label: string;
  readonly metadata: TokenMetadataMap;
  readonly value: string | null;
  readonly wallet: WalletBalance | null;
}) {
  const tokens = listWalletTokens(
    wallet,
    configured as Parameters<typeof listWalletTokens>[1],
  );
  const logoMints = [
    ...new Set([
      ...tokens.map((token) => token.asset.mint),
      ...additionalMints,
    ]),
  ]
    .filter((mint) => metadata.get(mint)?.imageUrl != null)
    .slice(0, MAX_LOGOS);

  return (
    <View style={styles.tile}>
      <Text maxFontSizeMultiplier={1.3} numberOfLines={2} style={styles.label}>
        {label}
      </Text>

      {/* The slot stays mounted when concealed so toggling privacy cannot resize the tile. */}
      <View
        accessibilityElementsHidden={hidden}
        importantForAccessibility={hidden ? 'no-hide-descendants' : 'auto'}
        style={[styles.tokens, hidden && styles.concealed]}
      >
        {logoMints.map((mint, index) => (
          <TokenLogo
            key={mint}
            size={24}
            style={index === 0 ? undefined : styles.logoOverlap}
            url={metadata.get(mint)?.imageUrl ?? null}
          />
        ))}
      </View>

      {value === null && !hidden ? (
        <SkeletonText role="label" width={64} />
      ) : (
        <ConcealedValue
          hidden={hidden}
          numberOfLines={1}
          style={styles.value}
          value={value ?? '***'}
        />
      )}
    </View>
  );
}

function zero(value: string): boolean {
  return /^-?0+(?:\.0+)?$/u.test(value);
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'stretch', gap: spacing.xs },
  // The panel's material at tile proportions, and the card's own corner so it does not read as pasted
  // in. No rim: the shape ends where its fill ends.
  tile: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xs,
    padding: spacing.md,
    borderRadius: radii.lg,
    borderCurve: 'continuous',
    backgroundColor: colors.glassHighlight,
  },
  label: { ...typography.caption, color: colors.textSecondary },
  tokens: { minHeight: 24, flexDirection: 'row', alignItems: 'center' },
  concealed: { opacity: 0 },
  logoOverlap: { marginLeft: -6 },
  value: {
    ...typography.label,
    color: colors.textPrimary,
    fontVariant: ['tabular-nums'],
  },
});
