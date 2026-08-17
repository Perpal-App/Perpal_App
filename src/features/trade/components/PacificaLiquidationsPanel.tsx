import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { MarketTrades } from '@/features/trade/components/PacificaDepthPanel';
import { usePacificaPublicMarket } from '@/features/trade/hooks/usePacificaPublicMarket';
import { colors, layout, radii, spacing, typography } from '@/theme/tokens';

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'market_liquidation', label: 'Market' },
  { id: 'backstop_liquidation', label: 'Backstop' },
  { id: 'insolvency_liquidation', label: 'Insolvency' },
] as const;

type Filter = (typeof FILTERS)[number]['id'];

export function PacificaLiquidationsPanel({
  apiOrigin,
  baseAsset,
  symbol,
  wsOrigin,
}: {
  readonly apiOrigin: string;
  readonly baseAsset: string;
  readonly symbol: string;
  readonly wsOrigin: string;
}) {
  const [filter, setFilter] = useState<Filter>('all');
  const market = usePacificaPublicMarket(apiOrigin, wsOrigin, symbol, 1, false);
  const liquidations = useMemo(
    () => market.trades.filter((trade) =>
      trade.cause.endsWith('_liquidation') && (filter === 'all' || trade.cause === filter),
    ),
    [filter, market.trades],
  );

  return (
    <View style={styles.panel}>
      <View>
        <Text style={styles.title}>Liquidations</Text>
        <Text accessibilityLiveRegion="polite" style={styles.muted}>
          {market.status === 'live' ? 'Live Pacifica executions' :
            market.status === 'error' ? 'Liquidation feed unavailable' : 'Connecting to Pacifica'}
        </Text>
      </View>
      <View accessibilityLabel="Liquidation cause" style={styles.filters}>
        {FILTERS.map((option) => (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: option.id === filter }}
            key={option.id}
            onPress={() => setFilter(option.id)}
            style={({ pressed }) => [
              styles.filter,
              option.id === filter && styles.filterSelected,
              pressed && styles.pressed,
            ]}
          >
            <Text style={option.id === filter ? styles.filterTextSelected : styles.filterText}>
              {option.label}
            </Text>
          </Pressable>
        ))}
      </View>
      <MarketTrades
        baseAsset={baseAsset}
        emptyText="No liquidation executions in the current recent and live feed."
        title={`${liquidations.length} recent liquidation${liquidations.length === 1 ? '' : 's'}`}
        trades={liquidations}
      />
      <Text style={styles.source}>
        Pacifica public taker trades · actual executions, not estimated liquidation levels
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { gap: spacing.md, paddingTop: spacing.xs },
  title: { ...typography.heading, color: colors.textPrimary },
  muted: { ...typography.caption, color: colors.textMuted },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xxs },
  filter: {
    minHeight: layout.minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
    borderRadius: radii.sm,
  },
  filterSelected: { backgroundColor: colors.surfaceElevated },
  filterText: { ...typography.caption, color: colors.textMuted },
  filterTextSelected: { ...typography.caption, color: colors.accentSoft },
  pressed: { opacity: 0.72 },
  source: { ...typography.caption, color: colors.textMuted },
});
