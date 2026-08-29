import { useCallback, useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';

import { SkeletonText } from '@/components/feedback/Skeleton';
import { FadeInView } from '@/components/motion/FadeInView';
import { UnderlineTabs, type UnderlineTabOption } from '@/components/ui/UnderlineTabs';
import type { AppConfig } from '@/config/appConfig';
import { MarketInfoList } from '@/features/trade/components/MarketInfoList';
import { PacificaDepthPanel } from '@/features/trade/components/PacificaDepthPanel';
import { PacificaTradesPanel } from '@/features/trade/components/PacificaMarketTrades';
import { PacificaFundingPanel } from '@/features/trade/components/PacificaFundingPanel';
import { PacificaLiquidationsPanel } from '@/features/trade/components/PacificaLiquidationsPanel';
import { PacificaOrderTicket } from '@/features/trade/components/PacificaOrderTicket';
import { PacificaTradeAccountPanel } from '@/features/trade/components/PacificaTradeAccountPanel';
import { TradingViewMarketChart } from '@/features/trade/components/TradingViewMarketChart';
import { usePacificaMarketHistory } from '@/features/trade/hooks/usePacificaMarketHistory';
import type { PacificaMarket, PacificaMarketSnapshot } from '@/integrations/perps/pacifica/pacificaMarketData';
import type { MarketTimeframe } from '@/integrations/perps/pacifica/pacificaHistory';
import { colors, radii, spacing } from '@/theme/tokens';

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
  readonly config: AppConfig;
  readonly market: PacificaMarket;
  readonly onExpandChart: () => void;
  readonly snapshot: PacificaMarketSnapshot | null;
}) {
  const [view, setView] = useState<WorkspaceView>('trade');
  const [panel, setPanel] = useState<MarketPanel>('orderbook');
  const [chartMounted, setChartMounted] = useState(false);
  const [timeframe, setTimeframe] = useState<MarketTimeframe>('15m');
  // React Native reports logical points, not screenshot pixels. A phone that is
  // 700+ physical pixels wide is normally 360-430 points, so 700 could never
  // activate the requested split layout in portrait.
  const wide = useWindowDimensions().width >= 340;
  const apiOrigin = props.config.perps.pacificaApiOrigin;
  const wsOrigin = props.config.perps.pacificaWsOrigin;
  const history = usePacificaMarketHistory(
    apiOrigin,
    props.market.venueRef,
    timeframe,
    chartMounted,
  );
  const selectView = useCallback((next: WorkspaceView) => {
    if (next === 'chart') setChartMounted(true);
    setView(next);
  }, []);

  return (
    <View style={styles.workspace}>
      <UnderlineTabs onSelect={selectView} options={VIEWS} selectedId={view} />

      {view === 'trade' ? (
        <FadeInView style={styles.tradeView}>
          <View style={[styles.tradeGrid, wide && styles.tradeGridWide]}>
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
                <View
                  accessibilityLabel="Refreshing Pacifica mark price"
                  accessibilityRole="progressbar"
                  style={styles.waiting}
                >
                  <SkeletonText role="heading" width={104} />
                  <SkeletonText role="bodyCompact" width="100%" />
                  <SkeletonText role="bodyCompact" width="82%" />
                </View>
              )}
            </View>
            <View style={styles.bookPanel}>
              <PacificaDepthPanel
                apiOrigin={apiOrigin}
                symbol={props.market.venueRef}
                tickSize={props.market.tickSize}
                variant="split"
                wsOrigin={wsOrigin}
              />
            </View>
          </View>
          <PacificaTradeAccountPanel apiOrigin={apiOrigin} />
        </FadeInView>
      ) : null}

      {chartMounted ? (
        <View style={view === 'chart' ? styles.chartVisible : styles.chartHidden}>
          <TradingViewMarketChart
            candles={history.candles}
            onExpand={props.onExpandChart}
            onTimeframeChange={setTimeframe}
            status={history.status}
            symbol={`${props.market.baseAsset}/USD`}
            timeframe={timeframe}
          />
        </View>
      ) : null}

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
  workspace: { width: '100%', minWidth: 0, gap: spacing.sm },
  tradeView: { width: '100%', minWidth: 0, gap: spacing.sm },
  tradeGrid: { width: '100%', minWidth: 0, gap: spacing.xs },
  // `stretch`, so both panels take the height of the taller one and their borders start and
  // end on the same two lines. Under `flex-start` each card was only as tall as its own
  // contents, which left the shorter of the two ending mid-column with a gap beneath it —
  // and made the book's level count a layout dependency of the ticket's row count.
  tradeGridWide: { flexDirection: 'row', alignItems: 'stretch' },
  tradePanel: { flex: 1, flexBasis: 0, minWidth: 0, overflow: 'hidden', paddingHorizontal: spacing.xs, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, borderRadius: radii.sm, backgroundColor: colors.surface },
  // No padding of its own: the book's rows, toolbar and footnote share one gutter that
  // the panel inside sets, so the depth bars end on the same line as the numbers above
  // them instead of on a second, narrower inset.
  bookPanel: { flex: 1, flexBasis: 0, minWidth: 0, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, borderRadius: radii.sm, backgroundColor: colors.surface },
  waiting: { minHeight: 180, justifyContent: 'center', gap: spacing.xs, paddingVertical: spacing.lg },
  chartVisible: { minWidth: 0 },
  chartHidden: { display: 'none' },
});
