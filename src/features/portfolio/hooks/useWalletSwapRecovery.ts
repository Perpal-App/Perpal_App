import { useCallback, useEffect, useRef, useState } from 'react';

import type { GatewayRequestSigner } from '@/integrations/api/gatewayClient';
import { reconcilePendingTradeAction } from '@/integrations/perps/tradeActionRecovery';
import { readPendingTradeAction } from '@/integrations/perps/tradeActionStorage';
import { showAppToast } from '@/storage/appToast';
import {
  captureInAppNotificationScope,
  publishInAppNotification,
} from '@/storage/inAppNotifications';

const POLL_INTERVAL_MS = 3_000;
const ERROR_RETRY_INTERVAL_MS = 5_000;

type RecoveryState = 'checking' | 'idle' | 'pending';

export function useWalletSwapRecovery({
  onBalancesChanged,
  owner,
  rpcUrl,
  signer,
  walletLabel,
}: {
  readonly onBalancesChanged: () => void;
  readonly owner: string | null;
  readonly rpcUrl: string | null;
  readonly signer: GatewayRequestSigner | null;
  readonly walletLabel: string;
}) {
  const key = recoveryKey(owner, rpcUrl, signer);
  const [resolvedKey, setResolvedKey] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [revision, setRevision] = useState(0);
  const resolvedKeyRef = useRef<string | null>(null);
  const pendingRef = useRef(false);
  const noticeOwner = useRef<string | null>(null);
  const errorNoticeOwner = useRef<string | null>(null);

  useEffect(() => {
    if (key === null || owner === null || rpcUrl === null || signer === null) {
      resolvedKeyRef.current = null;
      pendingRef.current = false;
      setResolvedKey(null);
      setPending(false);
      return undefined;
    }

    const controller = new AbortController();
    const notificationScope = captureInAppNotificationScope();
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let correlationSignature: string | null = null;
    void readPendingTradeAction(owner, 'wallet').then(async (record) => {
      correlationSignature = record?.signature ?? null;
      return reconcilePendingTradeAction({
        owner,
        provider: 'wallet',
        rpcUrl,
        signal: controller.signal,
        signer,
      });
    }).then((status) => {
      if (controller.signal.aborted) return;
      resolvedKeyRef.current = key;
      setResolvedKey(key);
      errorNoticeOwner.current = null;
      if (status === 'none' || status === 'expired') {
        pendingRef.current = false;
        noticeOwner.current = null;
        setPending(false);
        return;
      }
      if (status === 'confirmed') {
        pendingRef.current = false;
        noticeOwner.current = null;
        setPending(false);
        if (correlationSignature !== null) {
          publishInAppNotification({
            correlations: [{ namespace: 'solana-transaction', value: correlationSignature }],
            kind: 'wallet', outcome: 'success', status: 'settled',
            scopeToken: notificationScope,
            title: 'Swap confirmed', message: `${walletLabel} balances were updated.`,
          });
        } else {
          showAppToast({
            outcome: 'success',
            title: 'Swap confirmed',
            message: `${walletLabel} balances were updated.`,
          });
        }
        onBalancesChanged();
        return;
      }

      pendingRef.current = true;
      setPending(true);
      if (noticeOwner.current !== owner) {
        noticeOwner.current = owner;
        if (correlationSignature !== null) {
          publishInAppNotification({
            correlations: [{ namespace: 'solana-transaction', value: correlationSignature }],
            kind: 'wallet', outcome: 'info', status: 'submitted',
            scopeToken: notificationScope,
            title: 'Swap confirming', message: 'The signed swap is still confirming.',
          });
        } else {
          showAppToast({
            outcome: 'info',
            title: 'Swap confirming',
            message: 'The signed swap is still confirming.',
          });
        }
      }
      retryTimer = setTimeout(
        () => setRevision((value) => value + 1),
        POLL_INTERVAL_MS,
      );
    }).catch((cause) => {
      if (controller.signal.aborted) return;
      resolvedKeyRef.current = key;
      pendingRef.current = true;
      setResolvedKey(key);
      setPending(true);
      if (errorNoticeOwner.current !== owner) {
        errorNoticeOwner.current = owner;
        if (correlationSignature !== null) {
          publishInAppNotification({
            correlations: [{ namespace: 'solana-transaction', value: correlationSignature }],
            kind: 'wallet', outcome: 'error', status: 'failed',
            scopeToken: notificationScope,
            title: 'Swap recovery paused',
            message: 'The submitted swap could not be reconciled yet.',
          });
        } else {
          showAppToast({
            outcome: 'error',
            title: 'Swap recovery paused',
            message: cause instanceof Error ? cause.message : 'Swap recovery could not continue.',
          });
        }
      }
      retryTimer = setTimeout(
        () => setRevision((value) => value + 1),
        ERROR_RETRY_INTERVAL_MS,
      );
    });

    return () => {
      controller.abort();
      if (retryTimer !== undefined) clearTimeout(retryTimer);
    };
  }, [key, onBalancesChanged, owner, revision, rpcUrl, signer, walletLabel]);

  const resume = useCallback(() => {
    if (key === null) return;
    resolvedKeyRef.current = key;
    pendingRef.current = true;
    noticeOwner.current = owner;
    setResolvedKey(key);
    setPending(true);
    setRevision((value) => value + 1);
  }, [key, owner]);

  const isBlocked = useCallback(
    () => key !== null &&
      (resolvedKeyRef.current !== key || pendingRef.current),
    [key],
  );
  const checking = key !== null && resolvedKey !== key;
  const state: RecoveryState = checking ? 'checking' : pending ? 'pending' : 'idle';
  return { blocked: checking || pending, isBlocked, resume, state } as const;
}

function recoveryKey(
  owner: string | null,
  rpcUrl: string | null,
  signer: GatewayRequestSigner | null,
): string | null {
  return owner === null || rpcUrl === null || signer === null
    ? null
    : `${owner}\u0000${rpcUrl}\u0000${signer.publicKey}`;
}
