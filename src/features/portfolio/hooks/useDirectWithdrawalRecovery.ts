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
  | 'reviewing'
  | 'submitting';

/**
 * How often a submitted-but-unconfirmed withdrawal is re-checked, and for how long.
 *
 * `pending` used to be a terminal state in practice. Submission polls for its own window and then hands
 * back `submitted`, the panel showed "Withdrawal confirming", and nothing looked again until the reader
 * happened to reopen the sheet or start another transfer — so a transaction that confirmed four seconds
 * later still read as in flight, and one that never landed never said so. That is the whole of the "it
 * takes forever" complaint: it was not slow, it had stopped watching.
 *
 * The window is a backstop rather than the mechanism. `reconcilePendingTradeAction` settles from the
 * signature status and the blockhash, and a blockhash cannot outlive roughly 150 slots, so it reaches a
 * definitive answer inside a couple of minutes and the loop ends on that rather than on the clock.
 */
const WATCH_INTERVAL_MS = 2_000;
const WATCH_WINDOW_MS = 150_000;

export function useDirectWithdrawalRecovery({
  onBalancesChanged,
  owner,
  phase,
  rpcUrl,
  setPhase,
  signer,
}: {
  readonly onBalancesChanged: () => void | Promise<void>;
  readonly owner: string | null;
  /** The panel's current phase. `pending` is what arms the background watcher. */
  readonly phase: DirectWithdrawalPhase;
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
      if (status === 'confirmed') {
        void onBalancesChanged();
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
          message: 'Withdrawal is confirming on Solana.',
        });
        return;
      }
      setPhase('idle');
      showAppToast({
        outcome: 'info',
        message: 'Transfer expired. Funds unmoved.',
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

  // Keeps asking while the panel says a withdrawal is confirming, so that state resolves itself instead
  // of waiting for the reader to go and look. Chained timeouts rather than an interval: a poll that runs
  // long must not have the next one queued behind it.
  useEffect(() => {
    if (phase !== 'pending' || owner === null || rpcUrl === null || signer === null) {
      return undefined;
    }

    const abort = new AbortController();
    const notificationScope = captureInAppNotificationScope();
    const deadline = Date.now() + WATCH_WINDOW_MS;
    let timer: ReturnType<typeof setTimeout> | undefined;
    /**
     * The signature this watcher is following, read once when it arms.
     *
     * It is the correlation key, and without it the confirmation would be published as a second
     * notification beside the "submitted" one instead of replacing it — two entries in the list for one
     * transfer, the older of which says it is still settling. Read once rather than per poll because the
     * record cannot change while the phase holds: a new submission passes through `submitting` first,
     * which re-arms this effect.
     */
    let signature: string | null = null;

    const settle = (apply: () => void) => {
      if (abort.signal.aborted) return;
      setPhase('idle');
      void onBalancesChanged();
      apply();
    };

    const poll = async () => {
      let status;
      try {
        status = await reconcilePendingTradeAction({
          owner,
          provider: 'wallet-withdrawal',
          rpcUrl,
          signal: abort.signal,
          signer,
        });
      } catch (cause) {
        settle(() => publishResult(notificationScope, signature, {
          outcome: 'error',
          status: 'failed',
          title: 'Direct withdrawal failed',
          message: directErrorMessage(cause),
        }));
        return;
      }
      if (abort.signal.aborted) return;

      if (status === 'pending') {
        // Still in flight and still landable. Another pass, unless the backstop has run out — in which
        // case the phase stays as it is rather than being resolved on a guess, and the mount reconcile
        // will pick the record up again next time the sheet opens.
        if (Date.now() < deadline) timer = setTimeout(() => void poll(), WATCH_INTERVAL_MS);
        return;
      }

      if (status === 'confirmed') {
        settle(() => publishResult(notificationScope, signature, {
          outcome: 'success',
          status: 'settled',
          title: 'Direct withdrawal confirmed',
          message: 'The destination received the transfer.',
        }));
        return;
      }

      if (status === 'expired') {
        // Honest now in a way it was not: `reconcilePendingTradeAction` has read the signature status and
        // found nothing on chain, and read the blockhash and found it dead. The transfer cannot land, so
        // the amount really is where it started.
        settle(() => showAppToast({
          outcome: 'info',
          message: 'Transfer expired. Funds unmoved.',
        }));
        return;
      }

      // `none` — the record is gone, so some other path already settled this. Nothing to announce.
      settle(() => undefined);
    };

    // An unreadable record is not a reason to stop watching: the signature is only wanted for
    // correlation, and reconcile reads the record itself and will report the real failure.
    void readPendingTradeAction(owner, 'wallet-withdrawal')
      .then((record) => { signature = record?.signature ?? null; })
      .catch(() => { signature = null; })
      .finally(() => {
        if (!abort.signal.aborted) timer = setTimeout(() => void poll(), WATCH_INTERVAL_MS);
      });

    return () => {
      abort.abort();
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [onBalancesChanged, owner, phase, rpcUrl, setPhase, signer]);
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
