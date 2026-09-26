import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Alert } from 'react-native';

import { formatAmountWithCommas, formatSignedDetailedUsd } from '@/domain/money/amount';
import { positionFigures } from '@/domain/portfolio/positionFigures';
import { formatPositionPrice, tickPlaces } from '@/features/trade/components/positionText';
import type { ChartPositionLine } from '@/features/trade/components/TradingViewMarketChart';
import { usePacificaAccountSnapshot } from '@/features/trade/hooks/usePacificaAccountSnapshot';
import { positionKey, type PositionCloser } from '@/features/trade/hooks/usePacificaPositionClose';
import type { PacificaMarket, PacificaMarketSnapshot } from '@/integrations/perps/pacifica/pacificaMarketData';
import type { PacificaPosition } from '@/integrations/perps/pacifica/pacificaPortfolio';
import { useTradingSession } from '@/wallet/trading/TradingSessionProvider';

/** A line on the chart, with what its confirmation says about the position behind it. */
type DrawnPosition = {
  readonly entry: string;
  readonly line: ChartPositionLine;
  readonly mark: string | null;
  readonly position: PacificaPosition;
  readonly size: string;
};

/**
 * The account's open positions on one market, as the chart draws them, and the close the × on each asks for.
 *
 * Each line sits at the position's entry. Its tag carries the side, the size and the unrealized profit or
 * loss, worked out exactly as the position card works it out — the same integer figures from the same live
 * mark — so the chart and the card never disagree. The chart is handed the entry as a number to place the
 * line with, and nothing is valued from it.
 *
 * The × is the one close in the app that asks first. A card's Close sits under the figures it acts on; a ×
 * on a chart is small and sits among candles a finger is panning, so it is easy to hit by accident. It
 * raises a confirmation with the side, the size, the prices and the profit or loss, and only a second,
 * deliberate tap sends the close. Sending goes through the screen's shared closer, which checks the close
 * against what was shown and sends nothing if the position has changed.
 */
export function useChartPositions(input: {
  readonly apiOrigin: string;
  readonly closer: PositionCloser;
  readonly market: PacificaMarket | null;
  readonly snapshot: PacificaMarketSnapshot | null;
}): {
  readonly lines: readonly ChartPositionLine[];
  readonly requestClose: (id: string) => void;
} {
  const { apiOrigin, closer, market, snapshot } = input;
  const session = useTradingSession();
  const account = session.status === 'ready' ? session.address : null;
  const portfolio = usePacificaAccountSnapshot(apiOrigin, account).data;
  const places = market === null ? null : tickPlaces(market.tickSize);
  const mark = snapshot === null ? null : snapshot.price;

  const drawn = portfolio === null || market === null
    ? []
    : portfolio.positions.flatMap((position): DrawnPosition[] => {
      if (position.symbol !== market.venueRef) return [];
      const figures = positionFigures(position, mark, null);
      const price = Number(position.entryPrice);
      if (figures === null || !Number.isFinite(price) || price <= 0) return [];
      const key = positionKey(position);
      const pnl = figures.unrealizedPnl;
      const size = formatAmountWithCommas(figures.size);
      return [{
        entry: formatPositionPrice(figures.entryPrice, places),
        line: {
          closing: closer.closing === key,
          id: key,
          pnl: pnl === null ? '--' : formatSignedDetailedUsd(pnl),
          price,
          side: position.side,
          title: `${position.side === 'long' ? 'Long' : 'Short'} ${size}`,
          tone: pnl === null || pnl.baseUnits === 0n ? 'plain' : pnl.baseUnits > 0n ? 'positive' : 'negative',
        },
        mark: figures.mark === null ? null : formatPositionPrice(figures.mark, places),
        position,
        size,
      }];
    });

  // A new array for the chart only when something it draws has changed, so a tick that leaves every figure
  // where it was costs the chart nothing.
  const signature = JSON.stringify(drawn.map((item) => item.line));
  const lines = useMemo(() => JSON.parse(signature) as readonly ChartPositionLine[], [signature]);

  // What each × was drawn from, current after every commit, so the request below can stay one function for
  // the life of the chart.
  const latest = useRef({ closer, drawn });
  useEffect(() => {
    latest.current = { closer, drawn };
  });

  const requestClose = useCallback((id: string) => {
    const item = latest.current.drawn.find((candidate) => candidate.line.id === id);
    if (item === undefined || latest.current.closer.closing !== null) return;
    const { entry, line, position, size } = item;
    Alert.alert(
      `Close ${position.symbol} ${position.side}?`,
      [
        `${size} ${position.symbol} at market, reduce-only.`,
        `Entry ${entry} · Mark ${item.mark ?? '--'}`,
        `Unrealized PnL ${line.pnl}`,
      ].join('\n'),
      [
        { text: 'Keep open', style: 'cancel' },
        {
          text: 'Close position',
          style: 'destructive',
          onPress: () => latest.current.closer.close(position),
        },
      ],
    );
  }, []);

  return { lines, requestClose };
}
