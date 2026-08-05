import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';

import type { PerpsProviderId } from '@/config/appConfig';
import {
  fetchFlashMarketSnapshots,
  type FlashMarketSnapshot,
} from '@/integrations/perps/flash/flashMarketData';
import type { MainnetMarket } from '@/integrations/perps/markets/mainnetCatalog';

type VenueState = 'idle' | 'loading' | 'ready' | 'error';
const REFRESH_INTERVAL_MS = 3_000;

export function useFlashVenueMarkets(
  provider: PerpsProviderId,
  erRpcUrl: string,
  programId: string,
  markets: readonly MainnetMarket[],
) {
  const [snapshots, setSnapshots] = useState<readonly FlashMarketSnapshot[]>([]);
  const [status, setStatus] = useState<VenueState>('idle');
  const hasSnapshotsRef = useRef(false);
  const lastLoggedErrorRef = useRef<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (provider !== 'flash' || erRpcUrl.length === 0 || programId.length === 0) {
        hasSnapshotsRef.current = false;
        setSnapshots([]);
        setStatus('idle');
        return undefined;
      }

      let active = true;
      let controller: AbortController | null = null;
      let timer: ReturnType<typeof setTimeout> | undefined;

      const load = async (): Promise<void> => {
        controller?.abort();
        controller = new AbortController();

        if (!hasSnapshotsRef.current) {
          setStatus('loading');
        }

        try {
          const next = await fetchFlashMarketSnapshots(
            erRpcUrl,
            programId,
            markets,
            controller.signal,
          );

          if (active) {
            hasSnapshotsRef.current = true;
            lastLoggedErrorRef.current = null;
            setSnapshots(next);
            setStatus('ready');
          }
        } catch (cause) {
          if (active && !controller.signal.aborted) {
            const diagnostic = cause instanceof Error
              ? `${cause.name}:${cause.message}`
              : typeof cause;

            if (lastLoggedErrorRef.current !== diagnostic) {
              lastLoggedErrorRef.current = diagnostic;
              logFlashError(cause);
            }

            if (!hasSnapshotsRef.current) {
              setStatus('error');
            }
          }
        } finally {
          if (active) {
            timer = setTimeout(() => void load(), REFRESH_INTERVAL_MS);
          }
        }
      };

      void load();

      return () => {
        active = false;
        controller?.abort();

        if (timer !== undefined) {
          clearTimeout(timer);
        }
      };
    }, [erRpcUrl, markets, programId, provider]),
  );

  return { snapshots, status };
}

function logFlashError(cause: unknown): void {
  if (__DEV__) {
    console.error('[Perpal Flash ER venue data failed]', {
      errorName: cause instanceof Error ? cause.name : typeof cause,
      errorMessage:
        cause instanceof Error ? cause.message : 'Unknown Flash ER failure.',
    });
  }
}
