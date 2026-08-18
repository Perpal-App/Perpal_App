import { useFocusEffect } from 'expo-router';
import { useCallback, useSyncExternalStore } from 'react';

import {
  openVelocityMarketFeed,
  type VelocityMarket,
  type VelocityMarketSnapshot,
} from '@/integrations/perps/velocity/velocityMarketData';

type State = {
  readonly markets: readonly VelocityMarket[];
  readonly snapshots: readonly VelocityMarketSnapshot[];
  readonly status: 'idle' | 'loading' | 'ready' | 'error';
};

const EMPTY: State = { markets: [], snapshots: [], status: 'idle' };
const listeners = new Set<() => void>();
let state = EMPTY;
let activeKey = '';
let holders = 0;
let stop: (() => Promise<void>) | null = null;
let starting = false;

function publish(next: Partial<State>): void {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}

function retain(
  rpcUrl: string,
  programId: string,
  assetOrigin: string,
): () => void {
  const key = `${rpcUrl}|${programId}|${assetOrigin}`;
  if (activeKey !== key) {
    void stop?.();
    stop = null;
    activeKey = key;
    state = EMPTY;
    publish(EMPTY);
  }
  holders += 1;

  if (!starting && stop === null && rpcUrl.length > 0) {
    starting = true;
    publish({ status: 'loading' });
    void openVelocityMarketFeed({
      assetOrigin,
      onError: (cause) => {
        publish({ status: 'error' });
        logOnce(cause);
      },
      onUpdate: (feed) => publish({ ...feed, status: 'ready' }),
      programId,
      rpcUrl,
    }).then((release) => {
      starting = false;
      if (holders === 0 || activeKey !== key) {
        void release();
        return;
      }
      stop = release;
    }).catch((cause) => {
      starting = false;
      publish({ status: 'error' });
      logOnce(cause);
    });
  }

  let released = false;
  return () => {
    if (released) return;
    released = true;
    holders -= 1;
    if (holders !== 0) return;
    const release = stop;
    stop = null;
    if (release !== null) void release();
  };
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useVelocityMarkets(
  rpcUrl: string,
  programId: string,
  assetOrigin: string,
  enabled = true,
): State {
  useFocusEffect(useCallback(
    () => enabled ? retain(rpcUrl, programId, assetOrigin) : undefined,
    [assetOrigin, enabled, programId, rpcUrl],
  ));
  return useSyncExternalStore(subscribe, () => state, () => EMPTY);
}

let lastError = '';
function logOnce(cause: unknown): void {
  const message = cause instanceof Error ? `${cause.name}:${cause.message}` : typeof cause;
  if (!__DEV__ || message === lastError) return;
  lastError = message;
  console.warn('[Perpal Velocity market data failed]', { error: message });
}
