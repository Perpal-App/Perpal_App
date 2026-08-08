import { useFocusEffect } from 'expo-router';
import { useCallback, useSyncExternalStore } from 'react';

import {
  fetchPacificaMarketBundle,
  parsePacificaPriceMessage,
  type PacificaMarket,
  type PacificaMarketSnapshot,
} from '@/integrations/perps/pacifica/pacificaMarketData';

export type PacificaVenueState = 'idle' | 'loading' | 'ready' | 'error';

const HEARTBEAT_MS = 30_000;
const MAX_RECONNECT_MS = 15_000;
/**
 * How long the feed stays live after the last screen looks away.
 *
 * Tearing down on blur and rebuilding on focus is what made switching tabs feel sticky:
 * Home and Markets both read this feed, so every hop between them closed a socket and
 * then paid an HTTP round trip, a JSON parse and a socket handshake before the arriving
 * screen could show anything. Holding the connection briefly makes that hop free, while
 * still releasing it when the user has actually gone elsewhere — long enough to cover
 * navigation, short enough that a backgrounded app is not streaming prices.
 */
const IDLE_GRACE_MS = 20_000;

export type PacificaVenueSnapshotState = {
  readonly markets: readonly PacificaMarket[];
  readonly snapshots: readonly PacificaMarketSnapshot[];
  readonly status: PacificaVenueState;
};

const EMPTY: PacificaVenueSnapshotState = {
  markets: [],
  snapshots: [],
  status: 'idle',
};

/**
 * One venue feed for the whole app.
 *
 * Every screen showing Pacifica prices is showing the same prices, so there is one
 * connection and one copy of the data, and screens subscribe to it. Beyond removing the
 * per-switch reconnect, this also means two screens can never disagree about the price
 * of the same market, which two independent sockets could.
 *
 * Deliberately a module-level store rather than a context provider: the data outlives any
 * particular screen — that is the entire point of the grace period — and a provider would
 * have to be mounted above the tab shell to match, which is further from where it is used,
 * not closer.
 */
let state: PacificaVenueSnapshotState = EMPTY;
let key = '';
let holders = 0;
let stop: (() => void) | null = null;
let expiry: ReturnType<typeof setTimeout> | undefined;
let loggedError: string | null = null;
const listeners = new Set<() => void>();

function publish(next: Partial<PacificaVenueSnapshotState>): void {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function readState(): PacificaVenueSnapshotState {
  return state;
}

/**
 * Opens the feed and keeps it open until every holder has released it.
 *
 * Returns the release function so the caller's effect cleanup is the only way to give the
 * feed up — a holder cannot leak a connection by forgetting, and cannot close one another
 * screen is still using.
 */
function retain(apiOrigin: string, assetOrigin: string, wsOrigin: string): () => void {
  const next = `${apiOrigin}|${assetOrigin}|${wsOrigin}`;

  // A different venue is a different feed. Drop the old one outright rather than letting
  // it expire, or its prices would keep arriving for a venue nobody is looking at. The
  // reset is published, not just assigned: a screen already subscribed has to hear that
  // the data it is showing no longer belongs to the venue being asked for.
  if (next !== key) {
    stop?.();
    stop = null;
    key = next;
    state = { ...EMPTY };
    publish(EMPTY);
  }

  if (expiry !== undefined) {
    clearTimeout(expiry);
    expiry = undefined;
  }

  holders += 1;
  if (stop === null && apiOrigin.length > 0 && assetOrigin.length > 0 && wsOrigin.length > 0) {
    stop = open(apiOrigin, assetOrigin, wsOrigin);
  }

  let released = false;
  return () => {
    if (released) return;
    released = true;
    holders -= 1;
    if (holders > 0) return;

    expiry = setTimeout(() => {
      expiry = undefined;
      if (holders > 0) return;
      stop?.();
      stop = null;
    }, IDLE_GRACE_MS);
  };
}

function open(apiOrigin: string, assetOrigin: string, wsOrigin: string): () => void {
  let active = true;
  let attempts = 0;
  let controller: AbortController | null = null;
  let socket: WebSocket | null = null;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let reconnect: ReturnType<typeof setTimeout> | undefined;

  // Only announce loading with nothing to show. Once the feed has a catalog the screen is
  // already displaying the venue's last state, and reporting "connecting" over
  // live-looking data would be the wrong signal.
  if (state.markets.length === 0) publish({ status: 'loading' });

  const drop = () => {
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
    drop();
    controller = new AbortController();
    try {
      const bundle = await fetchPacificaMarketBundle(apiOrigin, assetOrigin, controller.signal);
      if (!active) return;
      publish({ markets: bundle.markets, snapshots: bundle.snapshots, status: 'ready' });
      loggedError = null;
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
            publish({ snapshots: mergeSnapshots(state.snapshots, next) });
          }
        } catch (cause) {
          logOnce(cause);
        }
      };
      socket.onerror = () => socket?.close();
      socket.onclose = () => {
        // A closed socket is not an error state to report. Reporting every reconnect as
        // "reconnecting" told the user something was wrong on a screen full of current
        // prices. The reconnect below is silent; a fetch that actually fails sets `error`.
        if (active) scheduleReconnect();
      };
    } catch (cause) {
      if (active && !controller.signal.aborted) {
        publish({ status: 'error' });
        logOnce(cause);
        scheduleReconnect();
      }
    }
  };

  void connect();

  return () => {
    active = false;
    drop();
    if (reconnect !== undefined) clearTimeout(reconnect);
  };
}

/**
 * Live Pacifica catalog and prices.
 *
 * Held while the calling screen is focused, so a blurred tab is not paying for a socket,
 * but released through the shared feed above rather than by closing it — so moving between
 * two screens that both read prices hands the connection over instead of rebuilding it.
 */
export function usePacificaMarkets(
  apiOrigin: string,
  assetOrigin: string,
  wsOrigin: string,
): PacificaVenueSnapshotState {
  useFocusEffect(
    useCallback(
      () => retain(apiOrigin, assetOrigin, wsOrigin),
      [apiOrigin, assetOrigin, wsOrigin],
    ),
  );

  // The store is the source of truth, so a screen that mounts while the feed is already
  // live renders current prices on its first frame with no effect having run yet.
  return useSyncExternalStore(subscribe, readState);
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

function logOnce(cause: unknown): void {
  const diagnostic = cause instanceof Error ? `${cause.name}:${cause.message}` : typeof cause;
  if (loggedError === diagnostic) return;
  loggedError = diagnostic;
  if (__DEV__) console.error('[Perpal Pacifica market data failed]', { error: diagnostic });
}
