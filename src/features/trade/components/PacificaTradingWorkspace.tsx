import { useState } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { FadeInView } from '@/components/motion/FadeInView';
import { UnderlineTabs, type UnderlineTabOption } from '@/components/ui/UnderlineTabs';
import type { AppConfig } from '@/config/appConfig';
import { MarketInfoList } from '@/features/trade/components/MarketInfoList';
import {
  PacificaDepthPanel,
  PacificaTradesPanel,
} from '@/features/trade/components/PacificaDepthPanel';
import { PacificaFundingPanel } from '@/features/trade/components/PacificaFundingPanel';
import { PacificaLiquidationsPanel } from '@/features/trade/components/PacificaLiquidationsPanel';
import { PacificaOrderTicket } from '@/features/trade/components/PacificaOrderTicket';
import { TradingViewMarketChart } from '@/features/trade/components/TradingViewMarketChart';
import type { MarketHistoryStatus } from '@/features/trade/hooks/usePacificaMarketHistory';
import type { PacificaMarket, PacificaMarketSnapshot } from '@/integrations/perps/pacifica/pacificaMarketData';
import type { MarketCandle, MarketTimeframe } from '@/integrations/perps/pacifica/pacificaHistory';
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

export function PacificaTradingWorkspace(props: {
  readonly candles: readonly MarketCandle[];
  readonly config: AppConfig;
  readonly historyStatus: MarketHistoryStatus;
  readonly market: PacificaMarket;
  readonly onExpandChart: () => void;
  readonly onTimeframeChange: (timeframe: MarketTimeframe) => void;
  readonly snapshot: PacificaMarketSnapshot | null;
  readonly timeframe: MarketTimeframe;
}) {
  const [view, setView] = useState<WorkspaceView>('trade');
  const [panel, setPanel] = useState<MarketPanel>('orderbook');
  const wide = useWindowDimensions().width >= 700;
  const apiOrigin = props.config.perps.pacificaApiOrigin;
  const wsOrigin = props.config.perps.pacificaWsOrigin;

  return (
    <View style={styles.workspace}>
      <UnderlineTabs onSelect={setView} options={VIEWS} selectedId={view} />

      {view === 'trade' ? (
        <FadeInView style={[styles.tradeGrid, wide && styles.tradeGridWide]}>
          <View style={styles.tradePanel}>
            {props.snapshot !== null && !props.snapshot.priceStale ? (
              <PacificaOrderTicket
                apiOrigin={apiOrigin}
                centralState={props.config.perps.pacificaCentralState}
                market={props.market}
                programId={props.config.perps.pacificaProgramId}
                rpcUrl={props.config.api.rpcUrl}
                snapshot={props.snapshot}
                swapBuildUrl={props.config.api.swapBuildUrl}
                usdcMint={props.config.perps.usdcMint}
                usdtMint={props.config.perps.usdtMint}
                vault={props.config.perps.pacificaVault}
              />
            ) : (
              <View style={styles.waiting}>
                <Text accessibilityLiveRegion="polite" style={styles.waitingTitle}>Trade unavailable</Text>
                <Text style={styles.waitingText}>Waiting for a current Pacifica mark price.</Text>
              </View>
            )}
          </View>
          <View style={styles.bookPanel}>
            <PacificaDepthPanel
              apiOrigin={apiOrigin}
              symbol={props.market.venueRef}
              tickSize={props.market.tickSize}
              wsOrigin={wsOrigin}
            />
          </View>
        </FadeInView>
      ) : null}

      <View style={view === 'chart' ? styles.chartVisible : styles.chartHidden}>
        <TradingViewMarketChart
          candles={props.candles}
          onExpand={props.onExpandChart}
          onTimeframeChange={props.onTimeframeChange}
          status={props.historyStatus}
          symbol={`${props.market.baseAsset}/USD`}
          timeframe={props.timeframe}
        />
      </View>

      {view === 'chart' ? (
        <>
          <UnderlineTabs onSelect={setPanel} options={PANELS} selectedId={panel} />
          <MarketPanelView
            apiOrigin={apiOrigin}
            market={props.market}
            panel={panel}
            snapshot={props.snapshot}
            wsOrigin={wsOrigin}
          />
        </>
      ) : null}
    </View>
  );
}

function MarketPanelView(props: {
  readonly apiOrigin: string;
  readonly market: PacificaMarket;
  readonly panel: MarketPanel;
  readonly snapshot: PacificaMarketSnapshot | null;
  readonly wsOrigin: string;
}) {
  return (
    <FadeInView>
      {props.panel === 'orderbook' ? (
        <PacificaDepthPanel apiOrigin={props.apiOrigin} symbol={props.market.venueRef} tickSize={props.market.tickSize} wsOrigin={props.wsOrigin} />
      ) : null}
      {props.panel === 'trades' ? (
        <PacificaTradesPanel apiOrigin={props.apiOrigin} baseAsset={props.market.baseAsset} symbol={props.market.venueRef} wsOrigin={props.wsOrigin} />
      ) : null}
      {props.panel === 'liquidations' ? (
        <PacificaLiquidationsPanel apiOrigin={props.apiOrigin} baseAsset={props.market.baseAsset} symbol={props.market.venueRef} wsOrigin={props.wsOrigin} />
      ) : null}
      {props.panel === 'funding' ? (
        <PacificaFundingPanel apiOrigin={props.apiOrigin} symbol={props.market.venueRef} />
      ) : null}
      {props.panel === 'info' ? <MarketInfoList market={props.market} snapshot={props.snapshot} /> : null}
    </FadeInView>
  );
}

const styles = StyleSheet.create({
  workspace: { gap: spacing.sm },
  tradeGrid: { gap: spacing.sm },
  tradeGridWide: { flexDirection: 'row', alignItems: 'flex-start' },
  tradePanel: { flex: 1, minWidth: 0, paddingHorizontal: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, borderRadius: radii.sm, backgroundColor: colors.surface },
  bookPanel: { flex: 1, minWidth: 0, paddingHorizontal: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, borderRadius: radii.sm, backgroundColor: colors.surface },
  waiting: { minHeight: 180, justifyContent: 'center', gap: spacing.xs, paddingVertical: spacing.lg },
  waitingTitle: { ...typography.heading, color: colors.textPrimary },
  waitingText: { ...typography.bodyCompact, color: colors.textSecondary },
  chartVisible: { minWidth: 0 },
  chartHidden: { display: 'none' },
});
