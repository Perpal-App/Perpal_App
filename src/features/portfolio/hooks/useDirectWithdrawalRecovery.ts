import { useEffect, type Dispatch, type SetStateAction } from 'react';

import type { GatewayRequestSigner } from '@/integrations/api/gatewayClient';
import { directErrorMessage } from '@/features/portfolio/components/directWithdrawPanelSupport';
import { reconcilePendingTradeAction } from '@/integrations/perps/tradeActionRecovery';
import { readPendingTradeAction } from '@/integrations/perps/tradeActionStorage';
import { showAppToast } from '@/storage/appToast';
import {
  captureInAppNotificationScope,
  publishInAppNotification,
  type InAppNotificationScopeToken,
} from '@/storage/inAppNotifications';

export type DirectWithdrawalPhase =
  | 'idle'
  | 'pending'
  | 'preparing'
  | 'quoting'
  | 'reviewing'
  | 'submitting';

export function useDirectWithdrawalRecovery({
  onBalancesChanged,
  owner,
  rpcUrl,
  setPhase,
  signer,
}: {
  readonly onBalancesChanged: () => void | Promise<void>;
  readonly owner: string | null;
  readonly rpcUrl: string | null;
  readonly setPhase: Dispatch<SetStateAction<DirectWithdrawalPhase>>;
  readonly signer: GatewayRequestSigner | null;
}): void {
  useEffect(() => {
    if (owner === null || rpcUrl === null || signer === null) return undefined;
    const abort = new AbortController();
    const notificationScope = captureInAppNotificationScope();
    let correlationSignature: string | null = null;

    void readPendingTradeAction(owner, 'wallet-withdrawal').then(async (record) => {
      correlationSignature = record?.signature ?? null;
      return reconcilePendingTradeAction({
        owner,
        provider: 'wallet-withdrawal',
        rpcUrl,
        signal: abort.signal,
        signer,
      });
    }).then((status) => {
      if (abort.signal.aborted || status === 'none') return;
      void onBalancesChanged();
      if (status === 'confirmed') {
        setPhase('idle');
        publishResult(notificationScope, correlationSignature, {
          outcome: 'success',
          status: 'settled',
          title: 'Direct withdrawal confirmed',
          message: 'The destination received the transfer and wallet balances were refreshed.',
        });
        return;
      }
      if (status === 'pending') {
        setPhase('pending');
        showAppToast({
          outcome: 'info',
          title: 'Withdrawal confirming',
          message: 'No balance is hidden or deducted locally while Solana confirms the transfer.',
        });
        return;
      }
      setPhase('idle');
      showAppToast({
        outcome: 'info',
        title: 'Withdrawal not confirmed',
        message: 'The signed transfer expired. The amount remains in the source wallet.',
      });
    }).catch((cause) => {
      if (abort.signal.aborted) return;
      setPhase('idle');
      void onBalancesChanged();
      publishResult(notificationScope, correlationSignature, {
        outcome: 'error',
        status: 'failed',
        title: 'Direct withdrawal failed',
        message: directErrorMessage(cause),
      });
    });

    return () => abort.abort();
  }, [onBalancesChanged, owner, rpcUrl, setPhase, signer]);
}

function publishResult(
  scopeToken: InAppNotificationScopeToken | null,
  signature: string | null,
  input: {
    readonly message: string;
    readonly outcome: 'error' | 'success';
    readonly status: 'failed' | 'settled';
    readonly title: string;
  },
): void {
  publishInAppNotification({
    ...(signature === null
      ? {}
      : { correlations: [{ namespace: 'solana-transaction' as const, value: signature }] }),
    kind: 'withdrawal',
    scopeToken,
    ...input,
  });
}
