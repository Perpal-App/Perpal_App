import { useState } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { FadeInView } from '@/components/motion/FadeInView';
import { UnderlineTabs, type UnderlineTabOption } from '@/components/ui/UnderlineTabs';
import type { AppConfig } from '@/config/appConfig';
import { VelocityDepthPanel } from '@/features/trade/components/VelocityDepthPanel';
import {
  VelocityFundingPanel,
  VelocityLiquidationsPanel,
  VelocityMarketInfoList,
  VelocityTradesPanel,
} from '@/features/trade/components/VelocityMarketPanels';
import { VelocityOrderTicket } from '@/features/trade/components/VelocityOrderTicket';
import { VelocityTradeAccountPanel } from '@/features/trade/components/VelocityTradeAccountPanel';
import { TradingViewMarketChart } from '@/features/trade/components/TradingViewMarketChart';
import { useVelocityPublicMarket } from '@/features/trade/hooks/useVelocityPublicMarket';
import { useVelocityMarketHistory } from '@/features/trade/hooks/useVelocityMarketHistory';
import type {
  VelocityMarket,
  VelocityMarketSnapshot,
} from '@/integrations/perps/velocity/velocityMarketData';
import type { MarketTimeframe } from '@/integrations/perps/pacifica/pacificaHistory';
import type { VelocityBookAggregation } from '@/integrations/perps/velocity/velocityPublicMarket';
import { colors, radii, spacing, typography } from '@/theme/tokens';

type WorkspaceView = 'trade' | 'chart';
type MarketPanel = 'orderbook' | 'trades' | 'liquidations' | 'funding' | 'info';

const VIEWS: readonly UnderlineTabOption<WorkspaceView>[] = [
  { id: 'trade', label: 'Trade' },
  { id: 'chart', label: 'Chart' },
];
const PANELS: readonly UnderlineTabOption<MarketPanel>[] = [
  { id: 'orderbook', label: 'Order book' },
  { id: 'trades', label: 'Trades' },
  { id: 'liquidations', label: 'Liquidations' },
  { id: 'funding', label: 'Funding rate' },
  { id: 'info', label: 'Market info' },
];

export function VelocityTradingWorkspace({
  config,
  market,
  snapshot,
}: {
  readonly config: AppConfig;
  readonly market: VelocityMarket;
  readonly snapshot: VelocityMarketSnapshot | null;
}) {
  const [view, setView] = useState<WorkspaceView>('trade');
  const [panel, setPanel] = useState<MarketPanel>('orderbook');
  const [aggregation, setAggregation] = useState<VelocityBookAggregation>(1);
  const [timeframe, setTimeframe] = useState<MarketTimeframe>('15m');
  const wide = useWindowDimensions().width >= 340;
  const publicMarket = useVelocityPublicMarket({
    aggregation,
    apiOrigin: config.perps.velocityDlobApiOrigin,
    marketIndex: market.marketIndex,
    marketName: market.marketName,
    wsOrigin: config.perps.velocityDlobWsOrigin,
  });
  const history = useVelocityMarketHistory(
    config.api.marketHistoryUrl,
    config.perps.pacificaApiOrigin,
    market.baseAsset,
    timeframe,
    view === 'chart',
  );

  return (
    <View style={styles.workspace}>
      <UnderlineTabs onSelect={setView} options={VIEWS} selectedId={view} />

      {view === 'trade' ? (
        <FadeInView style={styles.tradeView}>
          <View style={[styles.tradeGrid, wide && styles.tradeGridWide]}>
            <View style={styles.tradePanel}>
              {snapshot !== null && !snapshot.priceStale ? (
                <VelocityOrderTicket config={config} market={market} snapshot={snapshot} />
              ) : (
                <View style={styles.waiting}>
                  <Text accessibilityLiveRegion="polite" style={styles.waitingTitle}>
                    Trade unavailable
                  </Text>
                  <Text style={styles.waitingText}>Waiting for a current Velocity oracle price.</Text>
                </View>
              )}
            </View>
            <View style={styles.bookPanel}>
              <VelocityDepthPanel
                aggregation={aggregation}
                market={publicMarket}
                onAggregationChange={setAggregation}
                tickSize={market.tickSize}
                variant="split"
              />
            </View>
          </View>
          <VelocityTradeAccountPanel config={config} />
        </FadeInView>
      ) : null}

      <View style={view === 'chart' ? styles.chartVisible : styles.chartHidden}>
        <TradingViewMarketChart
          candles={history.candles}
          onTimeframeChange={setTimeframe}
          status={history.status}
          symbol={`${market.baseAsset}/USD · ${history.source === 'pyth' ? 'Pyth' : 'Pacifica'}`}
          timeframe={timeframe}
        />
      </View>

      {view === 'chart' ? (
        <>
          <UnderlineTabs onSelect={setPanel} options={PANELS} selectedId={panel} />
          <FadeInView>
            {panel === 'orderbook' ? (
              <VelocityDepthPanel
                aggregation={aggregation}
                market={publicMarket}
                onAggregationChange={setAggregation}
                tickSize={market.tickSize}
              />
            ) : null}
            {panel === 'trades' ? (
              <VelocityTradesPanel baseAsset={market.baseAsset} publicMarket={publicMarket} />
            ) : null}
            {panel === 'liquidations' ? (
              <VelocityLiquidationsPanel
                baseAsset={market.baseAsset}
                publicMarket={publicMarket}
              />
            ) : null}
            {panel === 'funding' ? <VelocityFundingPanel snapshot={snapshot} /> : null}
            {panel === 'info' ? (
              <VelocityMarketInfoList
                market={market}
                publicMarket={publicMarket}
                snapshot={snapshot}
              />
            ) : null}
          </FadeInView>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  workspace: { width: '100%', minWidth: 0, gap: spacing.sm },
  tradeView: { width: '100%', minWidth: 0, gap: spacing.sm },
  tradeGrid: { width: '100%', minWidth: 0, gap: spacing.xs },
  tradeGridWide: { flexDirection: 'row', alignItems: 'stretch' },
  tradePanel: {
    flex: 1,
    flexBasis: 0,
    minWidth: 0,
    overflow: 'hidden',
    paddingHorizontal: spacing.xs,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radii.sm,
    backgroundColor: colors.surface,
  },
  bookPanel: {
    flex: 1,
    flexBasis: 0,
    minWidth: 0,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radii.sm,
    backgroundColor: colors.surface,
  },
  waiting: { minHeight: 180, justifyContent: 'center', gap: spacing.xs, paddingVertical: spacing.lg },
  waitingTitle: { ...typography.heading, color: colors.textPrimary },
  waitingText: { ...typography.bodyCompact, color: colors.textSecondary },
  chartVisible: { minWidth: 0 },
  chartHidden: { display: 'none' },
});
