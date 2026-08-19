import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Connection, PublicKey } from '@solana/web3.js';
import { getUserAccountPublicKeySync } from '@velocity-exchange/sdk/lib/browser/addresses/pda';
import type { VelocityClient } from '@velocity-exchange/sdk/lib/browser/velocityClient';

import type { GatewayRequestSigner } from '@/integrations/api/gatewayClient';
import {
  readVelocityAccountSnapshot,
  type VelocityAccountSnapshot,
} from '@/integrations/perps/velocity/velocityAccount';
import {
  fetchVelocityTradeHistory,
  type VelocityTradeHistory,
} from '@/integrations/perps/velocity/velocityActivity';
import { subscribedVelocityClient } from '@/integrations/perps/velocity/velocityClient';

export type VelocityAccountState = {
  readonly snapshot: VelocityAccountSnapshot | null;
  readonly status: 'error' | 'loading' | 'not-created' | 'ready' | 'stale';
};

export type VelocityHistoryState = {
  readonly data: VelocityTradeHistory | null;
  readonly status: 'error' | 'idle' | 'loading' | 'ready';
};

const DISPLAY_REFRESH_MS = 2_000;

export function useVelocityAccount(input: {
  readonly historyRpcUrl?: string;
  readonly historySigner?: GatewayRequestSigner | null;
  readonly owner: string | null;
  readonly programId: string;
  readonly publicRpcUrl: string;
  readonly revision?: number;
}) {
  const [account, setAccount] = useState<VelocityAccountState>({
    snapshot: null,
    status: 'loading',
  });
  const [history, setHistory] = useState<VelocityHistoryState>({ data: null, status: 'idle' });
  const lastSnapshot = useRef<VelocityAccountSnapshot | null>(null);

  useFocusEffect(useCallback(() => {
    if (input.owner === null || input.publicRpcUrl.length === 0 || input.programId.length === 0) {
      setAccount({ snapshot: null, status: 'loading' });
      setHistory({ data: null, status: 'idle' });
      return undefined;
    }
    let active = true;
    let client: VelocityClient | null = null;
    let timer: ReturnType<typeof setInterval> | undefined;
    const abort = new AbortController();
    setAccount({ snapshot: null, status: 'loading' });
    setHistory({
      data: null,
      status: input.historyRpcUrl && input.historySigner ? 'loading' : 'idle',
    });
    lastSnapshot.current = null;

    const publish = () => {
      if (!active || client === null) return;
      try {
        const snapshot = readVelocityAccountSnapshot(client);
        lastSnapshot.current = snapshot;
        setAccount({ snapshot, status: 'ready' });
      } catch (cause) {
        if (__DEV__) console.warn('[Perpal Velocity account refresh failed]', safeError(cause));
        setAccount({
          snapshot: lastSnapshot.current,
          status: lastSnapshot.current === null ? 'error' : 'stale',
        });
      }
    };

    const start = async () => {
      try {
        const connection = new Connection(input.publicRpcUrl, 'confirmed');
        const ownerKey = new PublicKey(input.owner!);
        const velocityProgram = new PublicKey(input.programId);
        const userPda = getUserAccountPublicKeySync(velocityProgram, ownerKey, 0);
        const userExists = await connection.getAccountInfo(userPda, 'confirmed') !== null;
        if (!active) return;
        if (!userExists) {
          setAccount({ snapshot: null, status: 'not-created' });
          setHistory({ data: { trades: [], truncated: false }, status: 'ready' });
          return;
        }
        client = await subscribedVelocityClient({
          connection,
          owner: ownerKey,
          programId: velocityProgram,
          userExists,
        });
        if (!active) {
          await client.unsubscribe();
          client = null;
          return;
        }
        publish();
        timer = setInterval(publish, DISPLAY_REFRESH_MS);

        if (input.historyRpcUrl && input.historySigner) {
          try {
            const data = await fetchVelocityTradeHistory({
              client,
              rpcUrl: input.historyRpcUrl,
              signal: abort.signal,
              signer: input.historySigner,
              userPda,
            });
            if (active) setHistory({ data, status: 'ready' });
          } catch (cause) {
            if (active && !abort.signal.aborted) {
              if (__DEV__) console.warn('[Perpal Velocity history failed]', safeError(cause));
              setHistory({ data: null, status: 'error' });
            }
          }
        }
      } catch (cause) {
        if (active) {
          if (__DEV__) console.warn('[Perpal Velocity account load failed]', safeError(cause));
          setAccount({
            snapshot: lastSnapshot.current,
            status: lastSnapshot.current === null ? 'error' : 'stale',
          });
          setHistory((current) => current.status === 'loading'
            ? { data: null, status: 'error' }
            : current);
        }
      }
    };

    void start();
    return () => {
      active = false;
      abort.abort();
      if (timer !== undefined) clearInterval(timer);
      if (client !== null) void client.unsubscribe();
    };
  }, [
    input.historyRpcUrl,
    input.historySigner,
    input.owner,
    input.programId,
    input.publicRpcUrl,
    input.revision,
  ]));

  return { account, history };
}

function safeError(cause: unknown): { readonly message: string; readonly name: string } {
  return {
    message: cause instanceof Error ? cause.message : 'Unknown error',
    name: cause instanceof Error ? cause.name : typeof cause,
  };
}
