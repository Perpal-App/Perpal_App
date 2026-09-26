import { useMemo } from 'react';

import type { PositionMarket } from '@/features/trade/components/PositionCard';
import { useMarginSettings } from '@/features/trade/hooks/useMarginSettings';
import { usePacificaMarkets } from '@/features/trade/hooks/usePacificaMarkets';
import type { PacificaMarketSnapshot } from '@/integrations/perps/pacifica/pacificaMarketData';
import type { PacificaPosition } from '@/integrations/perps/pacifica/pacificaPortfolio';
import { useTradingSession } from '@/wallet/trading/TradingSessionProvider';

/** What a position card needs besides the position itself. */
export type LivePositionFacts = {
  /** The multiple the position runs at, or `null` while it is not known. */
  readonly leverage: number | null;
  readonly market: PositionMarket | null;
  /** The live market for the position's instrument, or `null` until the feed has it. */
  readonly snapshot: PacificaMarketSnapshot | null;
};

type MarketFacts = PositionMarket & { readonly maxLeverage: number };

/**
 * Everything a set of open positions is valued against, for every screen that draws position cards: the
 * market each one trades on, its streamed price, and the leverage it runs at.
 *
 * The price feed is the one shared feed the markets use, held only while there are positions to value and
 * a configured venue to value them against. The account's margin settings are read for the leverage, which
 * is where the capital a cross position uses comes from; a market with no setting of its own runs at the
 * venue's default, its maximum. Call this in the component that draws the cards, so a tick redraws the cards
 * and not the screen around them.
 *
 * Returns a lookup from a position to its facts, spread straight into a `PositionCard`.
 */
export function useLivePositions(input: {
  readonly apiOrigin: string;
  readonly assetOrigin: string;
  readonly positions: readonly PacificaPosition[];
  readonly wsOrigin: string;
}): (position: PacificaPosition) => LivePositionFacts {
  const { apiOrigin, assetOrigin, positions, wsOrigin } = input;
  const session = useTradingSession();
  const live = positions.length > 0 && apiOrigin.length > 0 && wsOrigin.length > 0;
  const venue = usePacificaMarkets(apiOrigin, assetOrigin, wsOrigin, live);
  const settings = useMarginSettings({
    account: session.status === 'ready' ? session.address : null,
    apiOrigin,
    symbols: positions.map((position) => position.symbol).sort().join(','),
  });

  const snapshots = useMemo(
    () => new Map<string, PacificaMarketSnapshot>(venue.snapshots.map((snapshot) => [snapshot.venueRef, snapshot])),
    [venue.snapshots],
  );
  const markets = useMemo(
    () => new Map<string, MarketFacts>(venue.markets.map((market) => [
      market.venueRef,
      { iconUrl: market.iconUrl, maxLeverage: market.maxLeverage, tickSize: market.tickSize },
    ])),
    [venue.markets],
  );

  return (position) => {
    const market = markets.get(position.symbol) ?? null;
    return {
      leverage: settings === null
        ? null
        : settings.get(position.symbol)?.leverage ?? market?.maxLeverage ?? null,
      market,
      snapshot: snapshots.get(position.symbol) ?? null,
    };
  };
}
