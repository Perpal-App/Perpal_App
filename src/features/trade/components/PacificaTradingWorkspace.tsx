import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { FadeInView } from '@/components/motion/FadeInView';
import { UnderlineTabs, type UnderlineTabOption } from '@/components/ui/UnderlineTabs';
import type { AppConfig } from '@/config/appConfig';
import { MarketInfoList } from '@/features/trade/components/MarketInfoList';
import { PacificaDepthPanel } from '@/features/trade/components/PacificaDepthPanel';
import { PacificaTradesPanel } from '@/features/trade/components/PacificaMarketTrades';
import { PacificaFundingPanel } from '@/features/trade/components/PacificaFundingPanel';
import { PacificaLiquidationsPanel } from '@/features/trade/components/PacificaLiquidationsPanel';
import { PacificaTradeAccountPanel } from '@/features/trade/components/PacificaTradeAccountPanel';
import { TradingViewMarketChart } from '@/features/trade/components/TradingViewMarketChart';
import { usePacificaMarketHistory } from '@/features/trade/hooks/usePacificaMarketHistory';
import type { PacificaMarket, PacificaMarketSnapshot } from '@/integrations/perps/pacifica/pacificaMarketData';
import type { MarketTimeframe } from '@/integrations/perps/pacifica/pacificaHistory';
import { spacing } from '@/theme/tokens';

type MarketPanel = 'orderbook' | 'trades' | 'liquidations' | 'funding' | 'info';

const PANELS: readonly UnderlineTabOption<MarketPanel>[] = [
  { id: 'orderbook', label: 'Order book' },
  { id: 'trades', label: 'Trades' },
  { id: 'liquidations', label: 'Liquidations' },
  { id: 'funding', label: 'Funding rate' },
  { id: 'info', label: 'Market info' },
];

/**
 * One market's workspace: the chart, the way into an order, the account, and the market's own panels —
 * in that order, in one column.
 *
 * It was two columns behind a `Trade | Chart` tab pair, and both of those are gone.
 *
 * The columns were a 50/50 split of the order ticket against the order book, nominally responsive but
 * not actually: the breakpoint was `width >= 340`, which every phone the app supports satisfies, so the
 * split was permanent and each half got about 150pt on a 360pt screen. A numeric form and a price
 * ladder are the two things on this screen that least want half a phone — the ticket's fields were
 * narrower than the numbers in them, and the book ran at nine levels with its size column dropped.
 *
 * The tabs were worse, because the chart was the thing they hid. A market screen's subject is its
 * price, and the chart opened on the second tab while the first showed a form. It is now the first
 * thing on the screen and always mounted, so no interaction is needed to see the market.
 *
 * Order entry moved into a sheet raised by the Buy and Sell buttons, which the screen pins below this
 * workspace rather than placing in it — same card, grabber and drag as the deposit and withdraw flows.
 * That is what let both columns go: the ticket no longer needs page width, so the book gets all of it
 * and runs at its full twelve levels in the panel strip below, alongside trades, liquidations, funding
 * and the instrument's facts.
 *
 * The buttons deliberately are not mounted here. They belong to the screen, not to the scrolling
 * content, so they stay reachable at any scroll position — see `MarketDetailScreen`'s footer.
 *
 * What did not move: the order lifecycle. The buttons only choose a side and open the ticket. Every
 * order still passes through the same prepare, the same projected-risk panel, the same explicit confirm
 * dialog and the same re-verification immediately before signing.
 */
export function PacificaTradingWorkspace(props: {
  readonly config: AppConfig;
  readonly market: PacificaMarket;
  readonly onExpandChart: () => void;
  readonly snapshot: PacificaMarketSnapshot | null;
}) {
  const [panel, setPanel] = useState<MarketPanel>('orderbook');
  const [timeframe, setTimeframe] = useState<MarketTimeframe>('15m');
  const apiOrigin = props.config.perps.pacificaApiOrigin;
  const wsOrigin = props.config.perps.pacificaWsOrigin;
  // Enabled unconditionally, where this used to wait for the chart's tab to be opened. The chart is the
  // first thing on the screen now, so its candles are first-screen data rather than a prefetch.
  const history = usePacificaMarketHistory(apiOrigin, props.market.venueRef, timeframe, true);

  return (
    <View style={styles.workspace}>
      <TradingViewMarketChart
        candles={history.candles}
        onExpand={props.onExpandChart}
        onTimeframeChange={setTimeframe}
        status={history.status}
        symbol={`${props.market.baseAsset}/USD`}
        timeframe={timeframe}
      />

      <PacificaTradeAccountPanel apiOrigin={apiOrigin} />

      <UnderlineTabs onSelect={setPanel} options={PANELS} selectedId={panel} />
      <MarketPanelView
        apiOrigin={apiOrigin}
        market={props.market}
        panel={panel}
        snapshot={props.snapshot}
        wsOrigin={wsOrigin}
      />
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
        // No `variant`, so the default full density: twelve levels with the size column, against the
        // nine and no size column the half-width split could carry.
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
});
