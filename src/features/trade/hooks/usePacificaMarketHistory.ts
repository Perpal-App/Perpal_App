import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';

import {
  fetchPacificaMarketHistory,
  type MarketCandle,
  type MarketTimeframe,
} from '@/integrations/perps/pacifica/pacificaHistory';

export type MarketHistoryStatus = 'loading' | 'ready' | 'stale' | 'error';
const REFRESH_INTERVAL_MS = 30_000;

/**
 * A series and the request it answers, kept together so the two can never be read apart.
 *
 * `timeframe: null` is the empty series, and no request can match it.
 */
type MarketSeries = {
  readonly candles: readonly MarketCandle[];
  readonly symbol: string;
  readonly timeframe: MarketTimeframe | null;
};

const NO_SERIES: MarketSeries = { candles: [], symbol: '', timeframe: null };

export function usePacificaMarketHistory(
  apiOrigin: string,
  symbol: string,
  timeframe: MarketTimeframe,
  enabled = true,
) {
  const [series, setSeries] = useState<MarketSeries>(NO_SERIES);
  const [status, setStatus] = useState<MarketHistoryStatus>('loading');
  const hasData = useRef(false);

  useFocusEffect(useCallback(() => {
    if (!enabled) return undefined;
    hasData.current = false;
    setSeries(NO_SERIES);
    setStatus('loading');
    let active = true;
    let controller: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      controller?.abort();
      controller = new AbortController();
      try {
        const next = await fetchPacificaMarketHistory(apiOrigin, symbol, timeframe, controller.signal);
        if (!active) return;
        hasData.current = next.length > 0;
        setSeries({ candles: next, symbol, timeframe });
        setStatus(next.length > 0 ? 'ready' : 'error');
      } catch {
        if (active && !controller.signal.aborted) setStatus(hasData.current ? 'stale' : 'error');
      } finally {
        if (active) timer = setTimeout(() => void load(), REFRESH_INTERVAL_MS);
      }
    };
    if (apiOrigin.length > 0 && symbol.length > 0) void load();
    else setStatus('error');
    return () => {
      active = false;
      controller?.abort();
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [apiOrigin, enabled, symbol, timeframe]));

  /**
   * Whether the series on hand is the one that was asked for, worked out during render.
   *
   * This is the fix for a stale window, and it has to happen here rather than in the effect above. The
   * effect does clear the series on a timeframe change, but a focus effect runs *after* the effects of
   * the components it feeds — so for one commit a consumer saw the previous interval's candles carrying
   * the new interval's label. The chart used that commit: it posted the old series to its document,
   * which consumed the one-shot fit flag that a timeframe change arms, and when the real series arrived
   * a moment later there was no fit left to spend on it. The new candles were drawn at the bar spacing
   * the old ones had been fitted to.
   *
   * That is why `ALL` looked like it stopped at the current year. Sixteen monthly candles inherited the
   * spacing of three hundred daily ones, so the whole history was a narrow cluster pinned to the right
   * edge with the axis showing only the year it ended in. Every other interval hid the same bug, because
   * they all return about three hundred candles and inheriting the spacing changes nothing.
   *
   * Derived, the mismatch cannot happen: the interval changes and the series is empty in the same
   * render, before any effect runs.
   */
  const answers = series.timeframe === timeframe && series.symbol === symbol;

  return {
    candles: answers ? series.candles : NO_SERIES.candles,
    // A failure is reported even though no series answers the request — that is exactly when there is
    // nothing to report but the failure. Otherwise a request without its series is still in flight.
    status: answers || status === 'error' ? status : 'loading',
  };
}
