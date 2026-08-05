import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { PerpsProviderId } from '@/config/appConfig';
import {
  fetchVelocityMarketSnapshots,
  type VelocityMarketSnapshot,
} from '@/integrations/perps/velocity/velocityMarketData';
import type { MainnetMarket } from '@/integrations/perps/markets/mainnetCatalog';
import type { PublicMarketPrice } from '@/integrations/perps/markets/publicMarketData';

type VenueState = 'idle' | 'loading' | 'ready' | 'error';
const REFRESH_INTERVAL_MS = 3_000;

export function useVelocityVenueMarkets(
  provider: PerpsProviderId,
  rpcUrl: string,
  programId: string,
  markets: readonly MainnetMarket[],
  prices: readonly PublicMarketPrice[],
) {
  const [snapshots, setSnapshots] = useState<readonly VelocityMarketSnapshot[]>([]);
  const [status, setStatus] = useState<VenueState>('idle');
  const pricesRef = useRef(prices);
  const hasSnapshotsRef = useRef(false);

  useEffect(() => {
    pricesRef.current = prices;
  }, [prices]);

  useFocusEffect(
    useCallback(() => {
      if (provider !== 'velocity' || rpcUrl.length === 0 || programId.length === 0) {
        hasSnapshotsRef.current = false;
        setSnapshots([]);
        setStatus('idle');
        return undefined;
      }

      let active = true;
      let controller: AbortController | null = null;
      let refreshTimer: ReturnType<typeof setTimeout> | undefined;

      const load = async (): Promise<void> => {
        controller?.abort();
        controller = new AbortController();

        if (!hasSnapshotsRef.current) {
          setStatus('loading');
        }

        try {
          const next = await fetchVelocityMarketSnapshots(
            rpcUrl,
            programId,
            markets,
            pricesRef.current,
            controller.signal,
          );

          if (active) {
            hasSnapshotsRef.current = true;
            setSnapshots(next);
            setStatus('ready');
          }
        } catch (cause) {
          if (active && !controller.signal.aborted) {
            logVenueError(cause);

            if (!hasSnapshotsRef.current) {
              setStatus('error');
            }
          }
        } finally {
          if (active) {
            refreshTimer = setTimeout(() => void load(), REFRESH_INTERVAL_MS);
          }
        }
      };

      void load();

      return () => {
        active = false;
        controller?.abort();

        if (refreshTimer !== undefined) {
          clearTimeout(refreshTimer);
        }
      };
    }, [markets, programId, provider, rpcUrl]),
  );

  return { snapshots, status };
}

function logVenueError(cause: unknown): void {
  if (__DEV__) {
    console.error('[Perpal Velocity venue data failed]', {
      errorName: cause instanceof Error ? cause.name : typeof cause,
    });
  }
}
