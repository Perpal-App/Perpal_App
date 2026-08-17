import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import {
  fetchPacificaOrderBook,
  fetchPacificaRecentTrades,
  parsePacificaPublicMarketMessage,
  type PacificaBookAggregation,
  type PacificaOrderBook,
  type PacificaPublicTrade,
} from '@/integrations/perps/pacifica/pacificaPublicMarket';

const HEARTBEAT_MS = 30_000;
const MAX_RECONNECT_MS = 15_000;
const MAX_TRADES = 80;

export type PacificaPublicMarketStatus = 'loading' | 'live' | 'reconnecting' | 'error';

export type PacificaPublicMarketState = {
  readonly book: PacificaOrderBook | null;
  readonly trades: readonly PacificaPublicTrade[];
  readonly status: PacificaPublicMarketStatus;
};

const EMPTY: PacificaPublicMarketState = {
  book: null,
  trades: [],
  status: 'loading',
};

/** REST snapshot first, then Pacifica's public book and taker-trade streams. */
export function usePacificaPublicMarket(
  apiOrigin: string,
  wsOrigin: string,
  symbol: string,
  aggregation: PacificaBookAggregation,
  includeBook = true,
): PacificaPublicMarketState {
  const [state, setState] = useState<PacificaPublicMarketState>(EMPTY);

  useFocusEffect(
    useCallback(() => {
      if (apiOrigin.length === 0 || wsOrigin.length === 0 || symbol.length === 0) {
        setState({ ...EMPTY, status: 'error' });
        return undefined;
      }

      let active = true;
      let attempts = 0;
      let controller: AbortController | null = null;
      let socket: WebSocket | null = null;
      let heartbeat: ReturnType<typeof setInterval> | undefined;
      let reconnect: ReturnType<typeof setTimeout> | undefined;
      let loggedError: string | null = null;

      const logOnce = (cause: unknown) => {
        const diagnostic = cause instanceof Error ? `${cause.name}:${cause.message}` : typeof cause;
        if (loggedError === diagnostic) return;
        loggedError = diagnostic;
        if (__DEV__) console.error('[Perpal Pacifica public market stream failed]', {
          error: diagnostic,
          symbol,
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
        if (heartbeat !== undefined) clearInterval(heartbeat);
        heartbeat = undefined;
      };

      const scheduleReconnect = (): void => {
        if (!active || reconnect !== undefined) return;
        const base = Math.min(MAX_RECONNECT_MS, 1000 * 2 ** attempts);
        attempts += 1;
        reconnect = setTimeout(() => {
          reconnect = undefined;
          setState((current) => ({ ...current, status: 'reconnecting' }));
          void connect();
        }, base + Math.floor(Math.random() * 500));
      };

      const applyBook = (book: PacificaOrderBook) => {
        if (book.symbol !== symbol) return;
        setState((current) => current.book !== null &&
          current.book.publishedAtMs > book.publishedAtMs
          ? current
          : { ...current, book });
      };

      const applyTrades = (trades: readonly PacificaPublicTrade[]) => {
        const relevant = trades.filter((trade) => trade.symbol === symbol);
        if (relevant.length === 0) return;
        setState((current) => ({
          ...current,
          trades: mergeTrades(current.trades, relevant),
        }));
      };

      const connect = async (): Promise<void> => {
        closeConnection();
        controller = new AbortController();
        const signal = controller.signal;
        const snapshot = await Promise.allSettled([
          includeBook
            ? fetchPacificaOrderBook(apiOrigin, symbol, aggregation, signal)
            : Promise.resolve(null),
          fetchPacificaRecentTrades(apiOrigin, symbol, signal),
        ]);
        if (!active || signal.aborted) return;

        if (snapshot[0].status === 'fulfilled') {
          if (snapshot[0].value !== null) applyBook(snapshot[0].value);
        } else logOnce(snapshot[0].reason);
        if (snapshot[1].status === 'fulfilled') applyTrades(snapshot[1].value);
        else logOnce(snapshot[1].reason);

        try {
          socket = new WebSocket(new URL('/ws', wsOrigin).toString());
          socket.onopen = () => {
            attempts = 0;
            loggedError = null;
            setState((current) => ({ ...current, status: 'live' }));
            if (includeBook) {
              socket?.send(JSON.stringify({
                method: 'subscribe',
                params: { source: 'book', symbol, agg_level: aggregation },
              }));
            }
            socket?.send(JSON.stringify({
              method: 'subscribe',
              params: { source: 'trades', symbol },
            }));
            heartbeat = setInterval(() => {
              if (socket?.readyState === WebSocket.OPEN) {
                socket.send(JSON.stringify({ method: 'ping' }));
              }
            }, HEARTBEAT_MS);
          };
          socket.onmessage = (event) => {
            try {
              const message = parsePacificaPublicMarketMessage(
                JSON.parse(String(event.data)) as unknown,
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
            if (heartbeat !== undefined) clearInterval(heartbeat);
            heartbeat = undefined;
            if (active) scheduleReconnect();
          };
        } catch (cause) {
          logOnce(cause);
          setState((current) => ({ ...current, status: 'error' }));
          scheduleReconnect();
        }
      };

      setState({ ...EMPTY });
      void connect();

      return () => {
        active = false;
        closeConnection();
        if (reconnect !== undefined) clearTimeout(reconnect);
      };
    }, [aggregation, apiOrigin, includeBook, symbol, wsOrigin]),
  );

  return state;
}

function mergeTrades(
  current: readonly PacificaPublicTrade[],
  incoming: readonly PacificaPublicTrade[],
): readonly PacificaPublicTrade[] {
  const byKey = new Map(current.map((trade) => [trade.key, trade]));
  for (const trade of incoming) byKey.set(trade.key, trade);
  return [...byKey.values()]
    .sort((left, right) => right.publishedAtMs - left.publishedAtMs)
    .slice(0, MAX_TRADES);
}
