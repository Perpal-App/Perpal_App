import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { IOSLoader } from '@/components/feedback/IOSLoader';
import { AppScreen } from '@/components/layout/AppScreen';
import { Button } from '@/components/ui/Button';
import { StatusRow } from '@/components/ui/StatusRow';
import { readAppConfig, type PerpsProviderId } from '@/config/appConfig';
import { formatAmount } from '@/domain/money/amount';
import { usePublicMarkets } from '@/features/trade/hooks/usePublicMarkets';
import {
  listMainnetMarkets,
  type MainnetMarket,
} from '@/integrations/perps/markets/mainnetCatalog';
import type { PublicMarketPrice } from '@/integrations/perps/markets/publicMarketData';
import { useAppPreferences } from '@/storage/AppPreferencesProvider';
import { colors, layout, radii, spacing, typography } from '@/theme/tokens';

export function TradeScreen() {
  const config = readAppConfig();
  const preferences = useAppPreferences();
  const provider = preferences.selectedPerpsProvider;
  const markets = useMemo(() => listMainnetMarkets(provider), [provider]);
  const marketDataUrl = config.ok ? config.value.api.marketDataUrl : '';
  const publicMarkets = usePublicMarkets(marketDataUrl);
  const prices = useMemo(
    () => new Map(publicMarkets.prices.map((price) => [price.symbol, price])),
    [publicMarkets.prices],
  );

  return (
    <AppScreen>
      <View style={styles.container}>
        <View style={styles.header}>
          <Text accessibilityRole="header" style={styles.title}>
            Markets
          </Text>
          <Text style={styles.subtitle}>Solana mainnet perpetuals</Text>
        </View>

        <View style={styles.providerPanel}>
          <Text accessibilityRole="header" style={styles.sectionTitle}>
            Trading provider
          </Text>
          <View style={styles.providerButtons}>
            <View style={styles.providerButton}>
              <ProviderButton
                label="Flash Trade v2"
                provider="flash"
                selected={provider}
                select={preferences.selectPerpsProvider}
              />
            </View>
            <View style={styles.providerButton}>
              <ProviderButton
                label="Drift"
                provider="drift"
                selected={provider}
                select={preferences.selectPerpsProvider}
              />
            </View>
          </View>
          <StatusRow label="Network" value="Solana mainnet" />
          <StatusRow
            label="Market access"
            value="Public · no wallet signature"
          />
        </View>

        {publicMarkets.status === 'loading' ? (
          <View accessibilityLabel="Loading mainnet markets" style={styles.loading}>
            <IOSLoader size="large" />
          </View>
        ) : null}

        {publicMarkets.status === 'error' ? (
          <View accessibilityRole="alert" style={styles.errorPanel}>
            <Text style={styles.errorTitle}>Markets unavailable</Text>
            <Text style={styles.note}>
              Check your connection and retry. Wallet access is not involved.
            </Text>
            <Button
              label="Retry market data"
              onPress={() => void publicMarkets.refresh()}
              variant="secondary"
            />
          </View>
        ) : null}

        <View style={styles.marketList}>
          {markets.map((market) => (
            <MarketCard
              key={market.symbol}
              market={market}
              price={prices.get(market.symbol) ?? null}
            />
          ))}
        </View>

        <Text style={styles.footerNote}>
          Prices load independently of Privy. A wallet signature is requested
          only after you review and confirm a specific order.
        </Text>
      </View>
    </AppScreen>
  );
}

function ProviderButton({
  label,
  provider,
  selected,
  select,
}: {
  readonly label: string;
  readonly provider: PerpsProviderId;
  readonly selected: PerpsProviderId;
  readonly select: (provider: PerpsProviderId) => void;
}) {
  return (
    <Button
      label={label}
      onPress={() => select(provider)}
      variant={selected === provider ? 'primary' : 'secondary'}
    />
  );
}

function MarketCard({
  market,
  price,
}: {
  readonly market: MainnetMarket;
  readonly price: PublicMarketPrice | null;
}) {
  return (
    <View style={styles.marketCard}>
      <View style={styles.marketHeader}>
        <View>
          <Text accessibilityRole="header" style={styles.marketSymbol}>
            {market.symbol}
          </Text>
          <Text style={styles.providerLabel}>{market.providerLabel}</Text>
        </View>
        <Text style={styles.marketPrice}>
          {price === null ? '—' : `$${formatAmount(price.price)}`}
        </Text>
      </View>
      <StatusRow
        label="Confidence"
        value={price === null ? '—' : `±$${formatAmount(price.confidence)}`}
      />
      <StatusRow
        label="Updated"
        value={
          price === null
            ? 'Loading'
            : price.stale
              ? 'Updating'
              : new Date(price.publishedAtMs).toLocaleTimeString()
        }
      />
      <StatusRow
        label="Max leverage"
        value={
          market.maxLeverage === null
            ? 'Set by provider risk tier'
            : `Up to ${market.maxLeverage}×`
        }
      />
      <StatusRow label="Price source" value={price?.source ?? 'Pyth Hermes'} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    width: '100%',
    maxWidth: layout.maxContentWidth,
    alignSelf: 'center',
    paddingHorizontal: layout.screenPadding,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl,
    gap: spacing.lg,
  },
  header: {
    paddingVertical: spacing.sm,
  },
  title: {
    ...typography.title,
    color: colors.textPrimary,
  },
  subtitle: {
    ...typography.bodyCompact,
    marginTop: spacing.xxs,
    color: colors.textSecondary,
  },
  providerPanel: {
    gap: spacing.md,
    paddingBottom: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  sectionTitle: {
    ...typography.heading,
    color: colors.textPrimary,
  },
  providerButtons: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  providerButton: {
    flex: 1,
  },
  loading: {
    minHeight: 120,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorPanel: {
    gap: spacing.md,
    padding: spacing.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
  },
  errorTitle: {
    ...typography.heading,
    color: colors.textPrimary,
  },
  note: {
    ...typography.bodyCompact,
    color: colors.textSecondary,
  },
  marketList: {
    gap: spacing.md,
  },
  marketCard: {
    gap: spacing.md,
    padding: spacing.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
  },
  marketHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  marketSymbol: {
    ...typography.heading,
    color: colors.textPrimary,
  },
  providerLabel: {
    ...typography.bodyCompact,
    marginTop: spacing.xxs,
    color: colors.textMuted,
  },
  marketPrice: {
    ...typography.heading,
    color: colors.textPrimary,
    fontVariant: ['tabular-nums'],
    textAlign: 'right',
  },
  footerNote: {
    ...typography.bodyCompact,
    color: colors.textSecondary,
  },
});
