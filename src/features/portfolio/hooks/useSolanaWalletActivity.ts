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
  readonly pacificaProgramId: string;
  readonly privateAddress: string;
  readonly publicAddress: string | null;
  /** True while a higher-priority funding or withdrawal interaction is open. */
  readonly paused: boolean;
  readonly rpcUrl: string;
  readonly signer: GatewayRequestSigner | null;
  readonly usdcMint: string;
  readonly usdtMint: string;
}) {
  const [state, setState] = useState<State>({ data: [], status: 'loading' });
  const [refreshKey, setRefreshKey] = useState(0);
  const updatedAtMs = useRef(0);
  const forceNetwork = useRef(false);
  // The private address is the identity; the object that signs gateway requests is a transport. Keeping
  // the latest transport in a ref prevents a provider render that recreates the same signer from
  // cancelling an eighty-transaction history load, clearing its rows, and starting it again.
  const signerRef = useRef(input.signer);
  signerRef.current = input.signer;
  const signerReady = input.signer !== null;
  const refresh = useCallback(() => {
    forceNetwork.current = true;
    setRefreshKey((value) => value + 1);
  }, []);

  useEffect(() => {
    updatedAtMs.current = 0;
    setState({ data: [], status: 'loading' });
  }, [
    input.pacificaProgramId,
    input.privateAddress,
    input.publicAddress,
    input.rpcUrl,
    signerReady,
    input.usdcMint,
    input.usdtMint,
  ]);

  useFocusEffect(useCallback(() => {
    const signer = signerRef.current;
    if (
      input.paused
      || input.publicAddress === null
      || input.pacificaProgramId.length === 0
      || input.privateAddress.length === 0
      || input.rpcUrl.length === 0
      || signer === null
      || input.usdcMint.length === 0
      || input.usdtMint.length === 0
    ) return undefined;
    const forced = forceNetwork.current;
    forceNetwork.current = false;
    if (!forced && Date.now() - updatedAtMs.current < REFRESH_AFTER_MS) return undefined;

    const controller = new AbortController();
    void fetchSolanaWalletActivity({
      pacificaProgramId: input.pacificaProgramId,
      privateAddress: input.privateAddress,
      publicAddress: input.publicAddress,
      rpcUrl: input.rpcUrl,
      signal: controller.signal,
      signer,
      usdcMint: input.usdcMint,
      usdtMint: input.usdtMint,
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
    input.pacificaProgramId,
    input.paused,
    input.privateAddress,
    input.publicAddress,
    input.rpcUrl,
    input.usdcMint,
    input.usdtMint,
    refreshKey,
    signerReady,
  ]));

  return { refresh, state };
}
