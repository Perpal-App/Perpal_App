import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';

import {
  fetchFlashMarketSnapshots,
  type FlashMarketSnapshot,
} from '@/integrations/perps/flash/flashMarketData';
import type { MainnetMarket } from '@/integrations/perps/markets/mainnetCatalog';

export type FlashVenueState = 'idle' | 'loading' | 'ready' | 'error';
const REFRESH_INTERVAL_MS = 15_000;

export function useFlashVenueMarkets(
  erRpcUrl: string,
  programId: string,
  dataOrigin: string,
  statsOrigin: string,
  markets: readonly MainnetMarket[],
) {
  const [snapshots, setSnapshots] = useState<readonly FlashMarketSnapshot[]>([]);
  const [status, setStatus] = useState<FlashVenueState>('idle');
  const hasSnapshotsRef = useRef(false);
  const lastLoggedErrorRef = useRef<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (
        erRpcUrl.length === 0 ||
        programId.length === 0 ||
        dataOrigin.length === 0 ||
        statsOrigin.length === 0 ||
        markets.length === 0
      ) {
        hasSnapshotsRef.current = false;
        setSnapshots([]);
        setStatus('idle');
        return undefined;
      }

      hasSnapshotsRef.current = false;
      setSnapshots([]);
      setStatus('loading');

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
            dataOrigin,
            statsOrigin,
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
    }, [dataOrigin, erRpcUrl, markets, programId, statsOrigin]),
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
