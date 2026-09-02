import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Connection, PublicKey } from '@solana/web3.js';
import { getUserAccountPublicKeySync } from '@velocity-exchange/sdk/lib/browser/addresses/pda';
import type { VelocityClient } from '@velocity-exchange/sdk/lib/browser/velocityClient';

import type { GatewayRequestSigner } from '@/integrations/api/gatewayClient';
import {
  EMPTY_VELOCITY_ACCOUNT_SNAPSHOT,
  readVelocityAccountSnapshot,
  type VelocityAccountSnapshot,
} from '@/integrations/perps/velocity/velocityAccount';
import {
  fetchVelocityTradeHistory,
  mergeVelocityTradeHistory,
  type VelocityTradeHistory,
} from '@/integrations/perps/velocity/velocityActivity';
import { subscribedVelocityClient } from '@/integrations/perps/velocity/velocityClient';

export type VelocityAccountState = {
  readonly snapshot: VelocityAccountSnapshot | null;
  readonly status: 'error' | 'loading' | 'not-created' | 'ready' | 'stale';
};

export type VelocityHistoryState = {
  readonly data: VelocityTradeHistory | null;
  readonly status: 'error' | 'idle' | 'loading' | 'ready' | 'stale';
};

const DISPLAY_REFRESH_MS = 2_000;
const HISTORY_REFRESH_MS = 5_000;

export function useVelocityAccount(input: {
  readonly enabled?: boolean;
  readonly historyRpcUrl?: string | undefined;
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
  const [refreshKey, setRefreshKey] = useState(0);
  const lastSnapshot = useRef<VelocityAccountSnapshot | null>(null);
  const historyData = useRef<VelocityTradeHistory | null>(null);
  const refresh = useCallback(() => setRefreshKey((value) => value + 1), []);

  useEffect(() => {
    lastSnapshot.current = null;
    historyData.current = null;
    setAccount({ snapshot: null, status: 'loading' });
    setHistory({ data: null, status: 'idle' });
  }, [input.historyRpcUrl, input.owner, input.programId, input.publicRpcUrl]);

  useFocusEffect(useCallback(() => {
    if (input.enabled === false) return undefined;

    if (input.owner === null || input.publicRpcUrl.length === 0 || input.programId.length === 0) {
      setAccount({ snapshot: null, status: 'loading' });
      setHistory({ data: null, status: 'idle' });
      return undefined;
    }
    let active = true;
    let client: VelocityClient | null = null;
    let accountTimer: ReturnType<typeof setInterval> | undefined;
    let historyTimer: ReturnType<typeof setTimeout> | undefined;
    const abort = new AbortController();
    if (lastSnapshot.current === null) setAccount({ snapshot: null, status: 'loading' });
    if (historyData.current === null) {
      setHistory({
        data: null,
        status: input.historyRpcUrl && input.historySigner ? 'loading' : 'idle',
      });
    }

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

    const loadHistory = async (userPda: PublicKey) => {
      if (!input.historyRpcUrl || !input.historySigner || client === null) return;
      try {
        const previous = historyData.current;
        const latest = await fetchVelocityTradeHistory({
          client,
          rpcUrl: input.historyRpcUrl,
          signal: abort.signal,
          signer: input.historySigner,
          ...(previous?.latestTx ? { untilTx: previous.latestTx } : {}),
          userPda,
        });
        if (active) {
          const next = previous === null
            ? latest
            : mergeVelocityTradeHistory(previous, latest);
          historyData.current = next;
          setHistory({ data: next, status: 'ready' });
        }
      } catch (cause) {
        if (active && !abort.signal.aborted) {
          if (__DEV__) console.warn('[Perpal Velocity history failed]', safeError(cause));
          setHistory({
            data: historyData.current,
            status: historyData.current === null ? 'error' : 'stale',
          });
        }
      } finally {
        if (active && !abort.signal.aborted) {
          historyTimer = setTimeout(() => void loadHistory(userPda), HISTORY_REFRESH_MS);
        }
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
          const emptyHistory: VelocityTradeHistory = {
            latestTx: null,
            trades: [],
            truncated: false,
          };
          lastSnapshot.current = EMPTY_VELOCITY_ACCOUNT_SNAPSHOT;
          historyData.current = emptyHistory;
          setAccount({ snapshot: EMPTY_VELOCITY_ACCOUNT_SNAPSHOT, status: 'not-created' });
          setHistory({ data: emptyHistory, status: 'ready' });
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
        accountTimer = setInterval(publish, DISPLAY_REFRESH_MS);
        void loadHistory(userPda);
      } catch (cause) {
        if (active) {
          if (__DEV__) console.warn('[Perpal Velocity account load failed]', safeError(cause));
          setAccount({
            snapshot: lastSnapshot.current,
            status: lastSnapshot.current === null ? 'error' : 'stale',
          });
          setHistory((current) => current.status === 'loading'
            ? {
                data: historyData.current,
                status: historyData.current === null ? 'error' : 'stale',
              }
            : current);
        }
      }
    };

    void start();
    return () => {
      active = false;
      abort.abort();
      if (accountTimer !== undefined) clearInterval(accountTimer);
      if (historyTimer !== undefined) clearTimeout(historyTimer);
      if (client !== null) void client.unsubscribe();
    };
  }, [
    input.enabled,
    input.historyRpcUrl,
    input.historySigner,
    input.owner,
    input.programId,
    input.publicRpcUrl,
    refreshKey,
    input.revision,
  ]));

  return {
    account,
    history,
    refresh,
  };
}

function safeError(cause: unknown): { readonly message: string; readonly name: string } {
  return {
    message: cause instanceof Error ? cause.message : 'Unknown error',
    name: cause instanceof Error ? cause.name : typeof cause,
  };
}
