import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';

import {
  fetchPacificaMarketBundle,
  parsePacificaPriceMessage,
  type PacificaMarket,
  type PacificaMarketSnapshot,
} from '@/integrations/perps/pacifica/pacificaMarketData';

export type PacificaVenueState = 'idle' | 'loading' | 'ready' | 'error';
const HEARTBEAT_MS = 30_000;
const MAX_RECONNECT_MS = 15_000;

export function usePacificaMarkets(apiOrigin: string, wsOrigin: string) {
  const [markets, setMarkets] = useState<readonly PacificaMarket[]>([]);
  const [snapshots, setSnapshots] = useState<readonly PacificaMarketSnapshot[]>([]);
  const [status, setStatus] = useState<PacificaVenueState>('idle');
  const loggedError = useRef<string | null>(null);

  useFocusEffect(useCallback(() => {
    if (apiOrigin.length === 0 || wsOrigin.length === 0) {
      setMarkets([]);
      setSnapshots([]);
      setStatus('idle');
      return undefined;
    }
    let active = true;
    let attempts = 0;
    let controller: AbortController | null = null;
    let socket: WebSocket | null = null;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let reconnect: ReturnType<typeof setTimeout> | undefined;
    setStatus('loading');

    const disconnect = () => {
      controller?.abort();
      socket?.close();
      socket = null;
      if (heartbeat !== undefined) clearInterval(heartbeat);
      heartbeat = undefined;
    };
    const scheduleReconnect = () => {
      if (!active || reconnect !== undefined) return;
      const base = Math.min(MAX_RECONNECT_MS, 1_000 * 2 ** attempts);
      attempts += 1;
      reconnect = setTimeout(() => {
        reconnect = undefined;
        void connect();
      }, base + Math.floor(Math.random() * 500));
    };
    const connect = async () => {
      disconnect();
      controller = new AbortController();
      try {
        const bundle = await fetchPacificaMarketBundle(apiOrigin, controller.signal);
        if (!active) return;
        setMarkets(bundle.markets);
        setSnapshots(bundle.snapshots);
        setStatus('ready');
        loggedError.current = null;
        attempts = 0;
        socket = new WebSocket(new URL('/ws', wsOrigin).toString());
        socket.onopen = () => {
          socket?.send(JSON.stringify({ method: 'subscribe', params: { source: 'prices' } }));
          heartbeat = setInterval(
            () => socket?.readyState === WebSocket.OPEN && socket.send(JSON.stringify({ method: 'ping' })),
            HEARTBEAT_MS,
          );
        };
        socket.onmessage = (event) => {
          try {
            const next = parsePacificaPriceMessage(JSON.parse(String(event.data)) as unknown);
            if (next !== null && active) {
              setSnapshots((current) => mergeSnapshots(current, next));
            }
          } catch (cause) {
            logOnce(loggedError, cause);
          }
        };
        socket.onerror = () => socket?.close();
        socket.onclose = () => {
          if (active) {
            setStatus('error');
            scheduleReconnect();
          }
        };
      } catch (cause) {
        if (active && !controller.signal.aborted) {
          setStatus('error');
          logOnce(loggedError, cause);
          scheduleReconnect();
        }
      }
    };

    void connect();
    return () => {
      active = false;
      disconnect();
      if (reconnect !== undefined) clearTimeout(reconnect);
    };
  }, [apiOrigin, wsOrigin]));

  return { markets, snapshots, status };
}

function mergeSnapshots(
  current: readonly PacificaMarketSnapshot[],
  next: readonly PacificaMarketSnapshot[],
): readonly PacificaMarketSnapshot[] {
  const map = new Map(current.map((snapshot) => [snapshot.venueRef, snapshot]));
  for (const snapshot of next) {
    const previous = map.get(snapshot.venueRef);
    if (previous === undefined || snapshot.pricePublishedAtMs >= previous.pricePublishedAtMs) {
      map.set(snapshot.venueRef, snapshot);
    }
  }
  return [...map.values()];
}

function logOnce(ref: { current: string | null }, cause: unknown): void {
  const diagnostic = cause instanceof Error ? `${cause.name}:${cause.message}` : typeof cause;
  if (ref.current === diagnostic) return;
  ref.current = diagnostic;
  if (__DEV__) console.error('[Perpal Pacifica market data failed]', { error: diagnostic });
}
