import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { GatewayRequestSigner } from '@/integrations/api/gatewayClient';
import {
  fetchSolanaWalletActivity,
  type SolanaWalletActivity,
} from '@/integrations/solana/solanaWalletActivity';

type State = {
  readonly data: readonly SolanaWalletActivity[];
  readonly status: 'error' | 'loading' | 'ready' | 'stale';
};

const REFRESH_AFTER_MS = 60_000;

export function useSolanaWalletActivity(input: {
  readonly privateAddress: string;
  readonly publicAddress: string | null;
  readonly rpcUrl: string;
  readonly signer: GatewayRequestSigner | null;
}) {
  const [state, setState] = useState<State>({ data: [], status: 'loading' });
  const [refreshKey, setRefreshKey] = useState(0);
  const updatedAtMs = useRef(0);
  const forceNetwork = useRef(false);
  const refresh = useCallback(() => {
    forceNetwork.current = true;
    setRefreshKey((value) => value + 1);
  }, []);

  useEffect(() => {
    updatedAtMs.current = 0;
    setState({ data: [], status: 'loading' });
  }, [input.privateAddress, input.publicAddress, input.rpcUrl, input.signer]);

  useFocusEffect(useCallback(() => {
    if (
      input.publicAddress === null
      || input.privateAddress.length === 0
      || input.rpcUrl.length === 0
      || input.signer === null
    ) return undefined;
    const forced = forceNetwork.current;
    forceNetwork.current = false;
    if (!forced && Date.now() - updatedAtMs.current < REFRESH_AFTER_MS) return undefined;

    const controller = new AbortController();
    void fetchSolanaWalletActivity({
      privateAddress: input.privateAddress,
      publicAddress: input.publicAddress,
      rpcUrl: input.rpcUrl,
      signal: controller.signal,
      signer: input.signer,
    }).then((data) => {
      if (controller.signal.aborted) return;
      updatedAtMs.current = Date.now();
      setState({ data, status: 'ready' });
    }).catch((cause: unknown) => {
      if (controller.signal.aborted) return;
      setState((current) => ({
        data: current.data,
        status: current.data.length === 0 ? 'error' : 'stale',
      }));
      if (__DEV__) {
        console.warn('[Perpal Solana activity refresh failed]', {
          errorName: cause instanceof Error ? cause.name : typeof cause,
        });
      }
    });

    return () => controller.abort();
  }, [
    input.privateAddress,
    input.publicAddress,
    input.rpcUrl,
    input.signer,
    refreshKey,
  ]));

  return { refresh, state };
}
