import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import {
  fetchVelocityOrderBook,
  parseVelocityPublicMarketMessage,
  type VelocityBookAggregation,
  type VelocityOrderBook,
  type VelocityPublicTrade,
} from '@/integrations/perps/velocity/velocityPublicMarket';

const MAX_RECONNECT_MS = 15_000;
const MAX_TRADES = 80;
const PUBLISH_INTERVAL_MS = 250;

export type VelocityPublicMarketStatus = 'loading' | 'live' | 'reconnecting' | 'error';

export type VelocityPublicMarketState = {
  readonly book: VelocityOrderBook | null;
  readonly status: VelocityPublicMarketStatus;
  readonly trades: readonly VelocityPublicTrade[];
};

const EMPTY: VelocityPublicMarketState = { book: null, status: 'loading', trades: [] };

/** Public REST snapshot plus Velocity's DLOB book and trade streams. */
export function useVelocityPublicMarket(input: {
  readonly aggregation: VelocityBookAggregation;
  readonly apiOrigin: string;
  readonly marketIndex: number;
  readonly marketName: string;
  readonly wsOrigin: string;
}): VelocityPublicMarketState {
  const [state, setState] = useState<VelocityPublicMarketState>(EMPTY);

  useFocusEffect(useCallback(() => {
    if (
      input.apiOrigin.length === 0 ||
      input.wsOrigin.length === 0 ||
      input.marketName.length === 0
    ) {
      setState({ ...EMPTY, status: 'error' });
      return undefined;
    }

    let active = true;
    let attempts = 0;
    let controller: AbortController | null = null;
    let socket: WebSocket | null = null;
    let reconnect: ReturnType<typeof setTimeout> | undefined;
    let publishTimer: ReturnType<typeof setTimeout> | undefined;
    let pendingBook: VelocityOrderBook | null = null;
    let pendingTrades: VelocityPublicTrade[] = [];
    let loggedError: string | null = null;

    const logOnce = (cause: unknown) => {
      const diagnostic = cause instanceof Error ? `${cause.name}:${cause.message}` : typeof cause;
      if (diagnostic === loggedError) return;
      loggedError = diagnostic;
      if (__DEV__) console.warn('[Perpal Velocity public market stream failed]', {
        error: diagnostic,
        marketIndex: input.marketIndex,
      });
    };

    const closeConnection = () => {
      controller?.abort();
      controller = null;
      if (socket !== null) {
        socket.onclose = null;
        socket.onerror = null;
        socket.close();
      }
      socket = null;
      if (publishTimer !== undefined) clearTimeout(publishTimer);
      publishTimer = undefined;
      pendingBook = null;
      pendingTrades = [];
    };

    const flush = () => {
      publishTimer = undefined;
      const book = pendingBook;
      const trades = pendingTrades;
      pendingBook = null;
      pendingTrades = [];
      if (!active || (book === null && trades.length === 0)) return;
      setState((current) => {
        const nextBook = book === null || (current.book !== null && current.book.slot > book.slot)
          ? current.book
          : book;
        const nextTrades = trades.length === 0
          ? current.trades
          : mergeTrades(current.trades, trades);
        return nextBook === current.book && nextTrades === current.trades
          ? current
          : { ...current, book: nextBook, trades: nextTrades };
      });
    };

    const schedulePublish = () => {
      publishTimer ??= setTimeout(flush, PUBLISH_INTERVAL_MS);
    };

    const scheduleReconnect = () => {
      if (!active || reconnect !== undefined) return;
      const base = Math.min(MAX_RECONNECT_MS, 1000 * 2 ** attempts);
      attempts += 1;
      reconnect = setTimeout(() => {
        reconnect = undefined;
        setState((current) => ({ ...current, status: 'reconnecting' }));
        connect();
      }, base + Math.floor(Math.random() * 500));
    };

    const applyBook = (book: VelocityOrderBook, immediate = false) => {
      if (immediate) {
        setState((current) => current.book !== null && current.book.slot > book.slot
          ? current
          : { ...current, book });
        return;
      }
      if (pendingBook === null || pendingBook.slot <= book.slot) pendingBook = book;
      schedulePublish();
    };

    const applyTrades = (trades: readonly VelocityPublicTrade[]) => {
      if (trades.length === 0) return;
      pendingTrades.push(...trades);
      schedulePublish();
    };

    const connect = () => {
      closeConnection();
      const requestController = new AbortController();
      controller = requestController;
      void fetchVelocityOrderBook({
        apiOrigin: input.apiOrigin,
        marketIndex: input.marketIndex,
        marketName: input.marketName,
        signal: requestController.signal,
      }).then((book) => {
        if (active && !requestController.signal.aborted) applyBook(book, true);
      }).catch((cause) => {
        if (active && !requestController.signal.aborted) logOnce(cause);
      });

      try {
        socket = new WebSocket(input.wsOrigin);
        socket.onopen = () => {
          attempts = 0;
          loggedError = null;
          setState((current) => ({ ...current, status: 'live' }));
          socket?.send(JSON.stringify({
            channel: 'orderbook',
            grouping: input.aggregation,
            includeIndicative: true,
            includeVamm: true,
            market: input.marketName,
            marketType: 'perp',
            type: 'subscribe',
          }));
          socket?.send(JSON.stringify({
            channel: 'trades',
            market: input.marketName,
            marketType: 'perp',
            type: 'subscribe',
          }));
        };
        socket.onmessage = (event) => {
          try {
            const message = parseVelocityPublicMarketMessage(
              JSON.parse(String(event.data)) as unknown,
              input.marketName,
              input.marketIndex,
            );
            if (!active || message === null) return;
            if (message.channel === 'book') applyBook(message.book);
            else applyTrades(message.trades);
          } catch (cause) {
            logOnce(cause);
          }
        };
        socket.onerror = () => socket?.close();
        socket.onclose = () => {
          if (active) scheduleReconnect();
        };
      } catch (cause) {
        logOnce(cause);
        setState((current) => ({ ...current, status: 'error' }));
        scheduleReconnect();
      }
    };

    setState({ ...EMPTY });
    connect();
    return () => {
      active = false;
      closeConnection();
      if (reconnect !== undefined) clearTimeout(reconnect);
    };
  }, [
    input.aggregation,
    input.apiOrigin,
    input.marketIndex,
    input.marketName,
    input.wsOrigin,
  ]));

  return state;
}

function mergeTrades(
  current: readonly VelocityPublicTrade[],
  incoming: readonly VelocityPublicTrade[],
): readonly VelocityPublicTrade[] {
  const byKey = new Map(current.map((trade) => [trade.key, trade]));
  for (const trade of incoming) byKey.set(trade.key, trade);
  return [...byKey.values()]
    .sort((left, right) => right.publishedAtMs - left.publishedAtMs)
    .slice(0, MAX_TRADES);
}
