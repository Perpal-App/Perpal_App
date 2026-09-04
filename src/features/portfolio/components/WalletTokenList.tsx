import { StyleSheet, Text, View } from 'react-native';

import { SkeletonText } from '@/components/feedback/Skeleton';
import { readAppConfig } from '@/config/appConfig';
import type { WalletBalance } from '@/features/account/hooks/useWalletBalances';
import { TokenLogo } from '@/features/portfolio/components/TokenLogo';
import {
  formatTokenAmount,
  listWalletTokens,
} from '@/features/portfolio/components/withdrawalAssets';
import { listTradingCollateralOptions } from '@/integrations/perps/providerCollateral';
import type { TokenMetadataMap } from '@/integrations/solana/tokenMetadata';
import { colors, spacing, typography } from '@/theme/tokens';

export function WalletTokenList({
  metadata,
  wallet,
}: {
  readonly metadata: TokenMetadataMap;
  readonly wallet: WalletBalance | null;
}) {
  const config = readAppConfig();
  const tokens = listWalletTokens(
    wallet,
    config.ok
      ? listTradingCollateralOptions(config.value.perps.usdcMint, config.value.perps.usdtMint)
      : [],
  );

  if (wallet === null) {
    return (
      <View accessibilityLabel="Loading wallet tokens" accessibilityRole="progressbar" style={styles.list}>
        <TokenSkeleton />
        <TokenSkeleton />
      </View>
    );
  }

  if (tokens.length === 0) {
    return <Text style={styles.empty}>No tokens in this wallet.</Text>;
  }

  return (
    <View style={styles.list}>
      {tokens.map((token, index) => (
        <View
          key={token.id ?? token.asset.mint}
          style={[styles.row, index > 0 && styles.rowBorder]}
        >
          <TokenLogo url={metadata.get(token.asset.mint)?.imageUrl ?? null} />
          <View style={styles.identity}>
            <Text numberOfLines={1} selectable style={styles.symbol}>{token.asset.symbol}</Text>
            <Text numberOfLines={1} selectable style={styles.mint}>
              {token.asset.kind === 'native' ? 'Solana' : short(token.asset.mint)}
            </Text>
          </View>
          <Text
            adjustsFontSizeToFit
            minimumFontScale={0.72}
            numberOfLines={1}
            selectable
            style={styles.amount}
          >
            {token.baseUnits === null
              ? '--'
              : formatTokenAmount(token.baseUnits, token.asset.decimals)}
          </Text>
        </View>
      ))}
    </View>
  );
}

function TokenSkeleton() {
  return (
    <View style={styles.row}>
      <SkeletonText role="label" width={72} />
      <SkeletonText role="label" width={92} />
    </View>
  );
}

function short(mint: string): string {
  return `${mint.slice(0, 4)}…${mint.slice(-4)}`;
}

const styles = StyleSheet.create({
  list: {
    overflow: 'hidden',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  row: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  rowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  identity: { flex: 1, minWidth: 0, gap: 1 },
  symbol: { ...typography.label, color: colors.textPrimary },
  mint: { ...typography.eyebrow, color: colors.textMuted },
  amount: {
    ...typography.label,
    maxWidth: '58%',
    color: colors.textPrimary,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  empty: { ...typography.bodyCompact, color: colors.textMuted, paddingVertical: spacing.md },
});
