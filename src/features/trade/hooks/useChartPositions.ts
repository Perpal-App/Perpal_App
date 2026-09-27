import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';

import { formatAmountWithCommas, formatSignedDetailedUsd } from '@/domain/money/amount';
import type { DialogOrigin } from '@/components/ui/ConfirmDialog';
import { positionFigures } from '@/domain/portfolio/positionFigures';
import type { PositionCloseSummary } from '@/features/trade/components/PositionCloseDialog';
import { formatPositionPrice, tickPlaces } from '@/features/trade/components/positionText';
import type { ChartPositionLine } from '@/features/trade/components/TradingViewMarketChart';
import { usePacificaAccountSnapshot } from '@/features/trade/hooks/usePacificaAccountSnapshot';
import { positionKey, type PositionCloser } from '@/features/trade/hooks/usePacificaPositionClose';
import type { PacificaMarket, PacificaMarketSnapshot } from '@/integrations/perps/pacifica/pacificaMarketData';
import type { PacificaPosition } from '@/integrations/perps/pacifica/pacificaPortfolio';
import { useTradingSession } from '@/wallet/trading/TradingSessionProvider';

/** A line on the chart, with what its confirmation says about the position behind it. */
type DrawnPosition = {
  readonly line: ChartPositionLine;
  readonly position: PacificaPosition;
  readonly summary: PositionCloseSummary;
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
 * opens `PositionCloseDialog` with the size, the prices and the profit or loss — live while it is open —
 * and only its second, deliberate button sends the close. Sending goes through the screen's shared closer,
 * which checks the close against the position and sends nothing if its side or size has changed.
 */
export function useChartPositions(input: {
  readonly apiOrigin: string;
  readonly closer: PositionCloser;
  readonly market: PacificaMarket | null;
  readonly snapshot: PacificaMarketSnapshot | null;
}): {
  /** For `PositionCloseDialog`. */
  readonly dialog: {
    readonly onCancel: () => void;
    readonly onConfirm: () => void;
    readonly origin: DialogOrigin | null;
    readonly summary: PositionCloseSummary | null;
  };
  readonly lines: readonly ChartPositionLine[];
  readonly requestClose: (id: string, origin: DialogOrigin | null) => void;
} {
  const { apiOrigin, closer, market, snapshot } = input;
  const session = useTradingSession();
  const account = session.status === 'ready' ? session.address : null;
  const portfolio = usePacificaAccountSnapshot(apiOrigin, account).data;
  const [asking, setAsking] = useState<string | null>(null);
  // Where the last × asked from. Kept after the answer, so the dialog can go back into it on its way out.
  const [origin, setOrigin] = useState<DialogOrigin | null>(null);
  const places = market === null ? null : tickPlaces(market.tickSize);
  const mark = snapshot === null ? null : snapshot.price;

  const drawn = portfolio === null || market === null
    ? []
    : portfolio.positions.flatMap((position): DrawnPosition[] => {
      if (position.symbol !== market.venueRef) return [];
      // Placed from the venue's own entry, so a position whose figures cannot be worked out is still on
      // the chart, with its profit and loss shown as unknown rather than the line going missing.
      const price = Number(position.entryPrice);
      if (!Number.isFinite(price) || price <= 0) return [];
      const figures = positionFigures(position, mark, null);
      const key = positionKey(position);
      const pnl = figures === null ? null : figures.unrealizedPnl;
      const pnlText = pnl === null ? '--' : formatSignedDetailedUsd(pnl);
      const tone = pnl === null || pnl.baseUnits === 0n ? 'plain' : pnl.baseUnits > 0n ? 'positive' : 'negative';
      const size = figures === null ? position.amount.replace(/^-/u, '') : formatAmountWithCommas(figures.size);
      return [{
        line: {
          closing: closer.closing === key,
          id: key,
          pnl: pnlText,
          price,
          side: position.side,
          title: `${position.side === 'long' ? 'Long' : 'Short'} ${size}`,
          tone,
        },
        position,
        summary: {
          entry: figures === null ? `$${position.entryPrice}` : formatPositionPrice(figures.entryPrice, places),
          id: key,
          mark: figures === null || figures.mark === null ? null : formatPositionPrice(figures.mark, places),
          pnl: pnlText,
          side: position.side,
          size,
          symbol: position.symbol,
          tone,
        },
      }];
    });

  // A new array for the chart only when something it draws has changed, so a tick that leaves every figure
  // where it was costs the chart nothing. The dialog's summary is held the same way, which is also what
  // lets it keep the last one through its exit.
  const signature = JSON.stringify(drawn.map((item) => item.line));
  const lines = useMemo(() => JSON.parse(signature) as readonly ChartPositionLine[], [signature]);
  const asked = asking === null ? undefined : drawn.find((item) => item.line.id === asking);
  const summarySignature = asked === undefined ? null : JSON.stringify(asked.summary);
  const summary = useMemo(
    () => summarySignature === null ? null : JSON.parse(summarySignature) as PositionCloseSummary,
    [summarySignature],
  );

  // A position that goes while it is being asked about — closed from its card, or by the venue — takes
  // the question with it, rather than leaving one that would come back if the same key reappeared.
  const gone = asking !== null && asked === undefined;
  useEffect(() => {
    if (gone) setAsking(null);
  }, [gone]);

  // What each × was drawn from, current after every commit, so the requests below stay one function each
  // for the life of the chart.
  const latest = useRef({ asking, closer, drawn });
  useEffect(() => {
    latest.current = { asking, closer, drawn };
  });

  const requestClose = useCallback((id: string, from: DialogOrigin | null) => {
    const { asking: open, closer: current, drawn: shown } = latest.current;
    // One question at a time: a second × tapped while one is asked, or while a close is running, is ignored.
    if (open !== null || current.closing !== null || !shown.some((item) => item.line.id === id)) return;
    if (Platform.OS === 'ios') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setOrigin(from);
    setAsking(id);
  }, []);

  const onCancel = useCallback(() => setAsking(null), []);

  const onConfirm = useCallback(() => {
    const { asking: id, closer: current, drawn: shown } = latest.current;
    const item = shown.find((candidate) => candidate.line.id === id);
    setAsking(null);
    // The position as the dialog last showed it, which is what the close is checked against.
    if (item !== undefined) current.close(item.position);
  }, []);

  const dialog = useMemo(
    () => ({ onCancel, onConfirm, origin, summary }),
    [onCancel, onConfirm, origin, summary],
  );

  return { dialog, lines, requestClose };
}
