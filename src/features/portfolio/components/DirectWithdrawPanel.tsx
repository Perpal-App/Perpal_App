import { useEmbeddedSolanaWallet } from '@privy-io/expo';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { PublicKey } from '@solana/web3.js';

import { readAppConfig } from '@/config/appConfig';
import type { WalletBalances } from '@/features/account/hooks/useWalletBalances';
import {
  DirectWithdrawForm,
  type DirectDestinationMode,
} from '@/features/portfolio/components/DirectWithdrawForm';
import {
  formatTokenAmount,
  parseTokenAmount,
  spendableMaximum,
} from '@/features/portfolio/components/withdrawalAssets';
import {
  DIRECT_REVIEW_NOTE,
  directErrorMessage,
  directReviewRows,
  directWithdrawalTokens,
  emptyBalanceMessage,
  loadingMessage,
  maxAmountMessage,
  pacificaReleaseRequirement,
  publicTransactionAuthority,
  shortAddress,
  walletAssetBalance,
  type DirectWithdrawalSource,
  type PacificaReleaseRequirement,
} from '@/features/portfolio/components/directWithdrawPanelSupport';
import { WithdrawReviewStep } from '@/features/portfolio/components/WithdrawReviewStep';
import {
  useDirectWithdrawalRecovery,
  type DirectWithdrawalPhase,
} from '@/features/portfolio/hooks/useDirectWithdrawalRecovery';
import type { PacificaPortfolioSnapshot } from '@/integrations/perps/pacifica/pacificaPortfolio';
import { showPacificaReleaseConfirmation } from '@/features/portfolio/components/pacificaReleaseConfirmation';
import {
  ensurePacificaCollateralInWallet,
  pendingPacificaWithdrawalBaseUnits,
  resumePacificaCollateralWithdrawalToWallet,
  type PacificaReleaseReceipt,
} from '@/integrations/perps/pacifica/pacificaWithdrawal';
import { reconcilePendingTradeAction } from '@/integrations/perps/tradeActionRecovery';
import {
  prepareDirectWithdrawal,
  submitDirectWithdrawal,
  type DirectWithdrawalPlan,
} from '@/integrations/solana/directWithdrawal';
import {
  captureInAppNotificationScope,
  publishInAppNotification,
} from '@/storage/inAppNotifications';
import { showAppToast } from '@/storage/appToast';
import { useTradingSession } from '@/wallet/trading/TradingSessionProvider';

export function DirectWithdrawPanel({
  balances,
  mainWalletAddress,
  onBalancesChanged,
  onPacificaRefresh,
  onReviewingChange,
  snapshot = null,
  source = 'private',
}: {
  readonly balances: WalletBalances | null;
  readonly mainWalletAddress: string | null;
  readonly onBalancesChanged: () => void | Promise<void>;
  readonly onPacificaRefresh?: () => void | Promise<void>;
  /**
   * Reports whether the review is on screen, so the sheet above can withdraw its own selectors.
   *
   * Required rather than optional: a call site that forgot it would leave the source and route choices
   * sitting above a plan they can no longer change.
   */
  readonly onReviewingChange: (reviewing: boolean) => void;
  readonly snapshot?: PacificaPortfolioSnapshot | null;
  readonly source?: DirectWithdrawalSource;
}) {
  const config = readAppConfig();
  const embeddedWallet = useEmbeddedSolanaWallet();
  const session = useTradingSession();
  const [amount, setAmount] = useState('');
  const [chosenId, setChosenId] = useState('');
  const [destinationMode, setDestinationMode] = useState<DirectDestinationMode>(
    source === 'public' ? 'external' : 'privy',
  );
  const [externalAddress, setExternalAddress] = useState('');
  const [phase, setPhase] = useState<DirectWithdrawalPhase>('idle');
  /** The prepared plan awaiting the reader's slide. Non-null is what swaps the form for the review. */
  const [pending, setPending] = useState<DirectWithdrawalPlan | null>(null);
  /** Confirmed provider debit/fee facts carried into the final Solana review. */
  const [releaseReceipt, setReleaseReceipt] = useState<PacificaReleaseReceipt | null>(null);
  const controller = useRef<AbortController | null>(null);
  /** Synchronous single-flight gate; React state cannot lock a second gesture until the next render. */
  const submitInFlight = useRef(false);
  const tokens = useMemo(
    () => directWithdrawalTokens(balances, source, snapshot),
    [balances, snapshot, source],
  );
  const selected = tokens.find((token) => token.id === chosenId) ?? tokens[0] ?? null;
  const asset = selected?.asset ?? null;
  const pacificaRelease = selected?.pacificaRelease ?? null;
  const amountHint = pacificaRelease === null
    ? undefined
    : `${formatTokenAmount(
        pacificaRelease.walletBaseUnits + pacificaRelease.grossBaseUnits,
        6,
      )} total · ${formatTokenAmount(pacificaRelease.feeBaseUnits, 6)} withdrawal fee · ${formatTokenAmount(
        pacificaRelease.walletBaseUnits + pacificaRelease.netBaseUnits,
        6,
      )} USDC receivable`;
  /**
   * The ceiling both "Max" and the typed-amount check work from.
   *
   * It is the spendable maximum, not the raw balance: for SOL those differ by the fee reserve, and
   * validating against the balance accepted an amount that could only fail once the plan priced the
   * transfer. One value now decides what Max fills in, what the range message quotes, and what a manual
   * entry is allowed to be.
   */
  const maxBaseUnits = selected === null ? null : spendableMaximum(selected);
  const running = phase !== 'idle';
  const owner = source === 'public' ? mainWalletAddress : session.address;

  useEffect(() => () => controller.current?.abort(), []);

  // A reviewed plan remains on screen while its signed transaction settles. Recovery resolves the phase
  // to idle on confirmation, failure, or definitive expiry; only then does the buffer yield back to the
  // form. This avoids showing editable inputs again while the same withdrawal is still in flight.
  useEffect(() => {
    if (phase === 'idle' && pending !== null) {
      setPending(null);
      setReleaseReceipt(null);
      setAmount('');
    }
  }, [pending, phase]);

  /**
   * Derived from `pending` in one place rather than announced by each of the four transitions that set
   * it. Missing one of those would leave the sheet's selectors on screen beside a prepared plan, and the
   * plan is the only thing that knows which step the reader is on.
   *
   * A layout effect, not a passive one: the parent's re-render removes the title and the source choice
   * from above this panel, and a passive effect lets the frame in between reach the screen — a flash of
   * the form's chrome over the review, with the whole step jumping up once it clears.
   */
  useLayoutEffect(() => {
    onReviewingChange(pending !== null);
  }, [onReviewingChange, pending]);

  useDirectWithdrawalRecovery({
    onBalancesChanged,
    owner,
    phase,
    rpcUrl: config.ok ? config.value.api.rpcUrl : null,
    setPhase,
    signer: session.signer,
  });

  const buildSolanaReview = async (input: {
    readonly amountBaseUnits: bigint;
    readonly destinationAddress: string;
    readonly releaseReceipt?: PacificaReleaseReceipt | null;
    readonly signal: AbortSignal;
  }) => {
    if (!config.ok || owner === null || session.signer === null || asset === null) {
      throw new Error('Withdrawal services are still loading.');
    }
    const plan = await prepareDirectWithdrawal({
      amountBaseUnits: input.amountBaseUnits,
      decimals: asset.decimals,
      destinationAddress: input.destinationAddress,
      kind: asset.kind,
      mint: asset.mint,
      owner,
      rpcUrl: config.value.api.rpcUrl,
      signal: input.signal,
      signer: session.signer,
      symbol: asset.symbol,
      ...(source === 'public'
        ? { transactionAuthorityPublicKey: new PublicKey(owner).toBytes() }
        : {}),
    });
    if (input.signal.aborted) return;
    review(plan, input.releaseReceipt ?? null);
  };

  const releasePacificaAndContinue = async (input: {
    readonly amountBaseUnits: bigint;
    readonly destinationAddress: string;
    readonly release: PacificaReleaseRequirement;
    readonly signal: AbortSignal;
  }) => {
    if (!config.ok || session.address === null || session.signer === null) return;
    setPhase('preparing');
    const withdrawalInput = {
      account: session.address,
      apiOrigin: config.value.perps.pacificaApiOrigin,
      mint: config.value.perps.usdcMint,
      rpcUrl: config.value.api.rpcUrl,
      signer: session.signer,
      signal: input.signal,
      withdrawalFeeBaseUnits: config.value.perps.pacificaWithdrawalFeeBaseUnits,
      wsOrigin: config.value.perps.pacificaWsOrigin,
    };
    try {
      const receipt = input.release.kind === 'resume'
        ? await resumePacificaCollateralWithdrawalToWallet(withdrawalInput)
        : await ensurePacificaCollateralInWallet(
            input.release.targetWalletBalanceBaseUnits,
            withdrawalInput,
          );
      if (input.signal.aborted) return;
      await Promise.all([
        onBalancesChanged(),
        onPacificaRefresh?.(),
      ]);
      await buildSolanaReview({
        amountBaseUnits: input.amountBaseUnits,
        destinationAddress: input.destinationAddress,
        releaseReceipt: receipt,
        signal: input.signal,
      });
    } catch (cause) {
      if (!input.signal.aborted) {
        setPhase('idle');
        onBalancesChanged();
        onPacificaRefresh?.();
        showAppToast({
          outcome: 'error',
          message: directErrorMessage(cause),
        });
      }
    }
  };

  /**
   * Fills the destination amount from the spendable balance already on screen. Pacifica-backed USDC
   * reports its gross debit and fee separately because its Max is necessarily the net receipt.
   */
  const fillMaximumAmount = () => {
    if (asset === null || maxBaseUnits === null) {
      showAppToast({ outcome: 'error', message: loadingMessage(source) });
      return;
    }
    if (maxBaseUnits <= 0n) {
      showAppToast({ outcome: 'error', message: emptyBalanceMessage(asset) });
      return;
    }
    setAmount(formatTokenAmount(maxBaseUnits, asset.decimals));
    showAppToast({
      outcome: 'info',
      message: pacificaRelease === null
        ? maxAmountMessage({
            decimals: asset.decimals,
            kind: asset.kind,
            maxBaseUnits,
            symbol: asset.symbol,
          })
        : `Withdraw all ${formatTokenAmount(
            pacificaRelease.walletBaseUnits + pacificaRelease.grossBaseUnits,
            6,
          )}. Receive ${formatTokenAmount(maxBaseUnits, 6)} after withdrawal fee.`,
    });
  };

  const prepare = async () => {
    if (
      !config.ok ||
      session.status !== 'ready' ||
      owner === null ||
      session.signer === null ||
      selected === null ||
      asset === null ||
      maxBaseUnits === null
    ) {
      showAppToast({ outcome: 'error', message: loadingMessage(source) });
      return;
    }

    // Amount and destination are checked apart because they fail for unrelated reasons. Reporting both
    // as an amount problem is what made an empty address field read as an amount that was too large.
    let amountBaseUnits: bigint;
    try {
      amountBaseUnits = parseTokenAmount(amount, asset.decimals);
      if (amountBaseUnits <= 0n || amountBaseUnits > maxBaseUnits) throw new Error('out of range');
    } catch {
      showAppToast({
        outcome: 'error',
        message: maxBaseUnits <= 0n
          ? emptyBalanceMessage(asset)
          : `Enter up to ${formatTokenAmount(maxBaseUnits, asset.decimals)} ${asset.symbol}.`,
      });
      return;
    }

    let destinationAddress: string;
    try {
      destinationAddress = new PublicKey(
        destinationMode === 'privy' ? mainWalletAddress ?? '' : externalAddress.trim(),
      ).toBase58();
    } catch {
      showAppToast({
        outcome: 'error',
        message: destinationMode === 'privy'
          ? 'Public wallet still loading.'
          : 'Enter a destination address.',
      });
      return;
    }

    const privateUsdc = source === 'private' && asset.kind === 'spl' &&
      asset.mint === config.value.perps.usdcMint;

    controller.current?.abort();
    setReleaseReceipt(null);
    const abort = new AbortController();
    controller.current = abort;
    setPhase('preparing');
    try {
      const pending = await reconcilePendingTradeAction({
        owner,
        provider: 'wallet-withdrawal',
        rpcUrl: config.value.api.rpcUrl,
        signal: abort.signal,
        signer: session.signer,
      });
      if (pending === 'pending') {
        setPhase('pending');
        showAppToast({ outcome: 'info', message: 'A signed withdrawal is still settling.' });
        return;
      }
      if (pending === 'confirmed') {
        setPhase('idle');
        onBalancesChanged();
        showAppToast({ outcome: 'success', message: 'Previous withdrawal confirmed.' });
        return;
      }

      if (privateUsdc && session.address !== null) {
        const pendingProviderAmount = await pendingPacificaWithdrawalBaseUnits(session.address);
        const release = pacificaReleaseRequirement({
          feeBaseUnits: config.value.perps.pacificaWithdrawalFeeBaseUnits,
          pendingBaseUnits: pendingProviderAmount,
          targetWalletBalanceBaseUnits: amountBaseUnits,
          walletBaseUnits: walletAssetBalance(balances?.privateWallet, selected),
        });
        if (release !== null) {
          setPhase('reviewing');
          showPacificaReleaseConfirmation({
            feeBaseUnits: config.value.perps.pacificaWithdrawalFeeBaseUnits,
            release,
            onCancel: () => {
              abort.abort();
              setPhase('idle');
            },
            onConfirm: () => void releasePacificaAndContinue({
              amountBaseUnits,
              destinationAddress,
              release,
              signal: abort.signal,
            }),
          });
          return;
        }
      }

      await buildSolanaReview({
        amountBaseUnits,
        destinationAddress,
        signal: abort.signal,
      });
    } catch (cause) {
      if (!abort.signal.aborted) {
        setPhase('idle');
        onBalancesChanged();
        showAppToast({ outcome: 'error', message: directErrorMessage(cause) });
      }
    }
  };

  /** Holds the exact Solana plan and confirmed provider receipt in the in-sheet review. */
  const review = (
    plan: DirectWithdrawalPlan,
    receipt: PacificaReleaseReceipt | null,
  ) => {
    setReleaseReceipt(receipt);
    setPhase('reviewing');
    setPending(plan);
  };

  const cancelReview = () => {
    controller.current?.abort();
    setPending(null);
    setReleaseReceipt(null);
    setPhase('idle');
  };

  const submit = async (plan: DirectWithdrawalPlan) => {
    if (!config.ok || session.signer === null || submitInFlight.current) return;
    // Set before any await. A fast second finalize from the slider otherwise reaches this callback before
    // `phase="submitting"` has rendered and can ask Privy for a second signature of the same intent.
    submitInFlight.current = true;
    const notificationScope = captureInAppNotificationScope();
    setPhase('submitting');
    try {
      const transactionAuthority = source === 'public'
        ? await publicTransactionAuthority(plan.owner, embeddedWallet)
        : undefined;
      const result = await submitDirectWithdrawal({
        plan,
        rpcUrl: config.value.api.rpcUrl,
        signer: session.signer,
        ...(transactionAuthority === undefined ? {} : { transactionAuthority }),
      });
      if (result.status === 'confirmed') {
        setPending(null);
        setReleaseReceipt(null);
        onBalancesChanged();
        setAmount('');
        setPhase('idle');
        publishInAppNotification({
          correlations: [{ namespace: 'solana-transaction', value: result.signature }],
          kind: 'withdrawal', outcome: 'success', title: 'Direct withdrawal confirmed',
          scopeToken: notificationScope,
          status: 'settled',
          message: `${formatTokenAmount(plan.amountBaseUnits, plan.decimals)} ${plan.symbol} reached ${shortAddress(plan.destinationAddress)}.`,
        });
      } else {
        setPhase('pending');
        publishInAppNotification({
          correlations: [{ namespace: 'solana-transaction', value: result.signature }],
          kind: 'withdrawal', outcome: 'info', title: 'Direct withdrawal submitted',
          scopeToken: notificationScope,
          status: 'submitted',
          message: 'Confirming on Solana. Balances refresh once settled.',
        });
      }
    } catch (cause) {
      // Back to the review rather than back to the form: the plan is still the one the reader approved,
      // and a failure that leaves nothing on screen to retry sends them through the whole form again.
      setPhase('reviewing');
      onBalancesChanged();
      publishInAppNotification({
        kind: 'withdrawal', outcome: 'error', title: 'Direct withdrawal failed',
        scopeToken: notificationScope,
        message: directErrorMessage(cause),
      });
    } finally {
      submitInFlight.current = false;
    }
  };

  // The prepared plan owns every choice while it is visible, so the form and selectors yield to it.
  if (pending !== null) {
    return (
      <WithdrawReviewStep
        confirming={phase === 'submitting' || phase === 'pending'}
        headline={`${formatTokenAmount(pending.amountBaseUnits, pending.decimals)} ${pending.symbol}`}
        note={DIRECT_REVIEW_NOTE}
        onBack={cancelReview}
        onConfirm={() => void submit(pending)}
        rows={directReviewRows(pending, releaseReceipt)}
        slideLabel={source === 'public' ? 'Slide to send' : 'Slide to withdraw'}
        title={source === 'public' ? 'Review send' : 'Review withdrawal'}
        workingLabel={source === 'public' ? 'Sending' : 'Withdrawing'}
      />
    );
  }

  return (
    <DirectWithdrawForm
      amount={amount}
      {...(amountHint === undefined ? {} : { amountHint })}
      destinationMode={destinationMode}
      disabled={asset === null || (destinationMode === 'privy' && mainWalletAddress === null)}
      externalAddress={externalAddress}
      maxDisabled={asset === null}
      onAmountChange={(value) => {
        setAmount(value);
        setReleaseReceipt(null);
      }}
      onDestinationMode={setDestinationMode}
      onExternalAddress={setExternalAddress}
      onMax={fillMaximumAmount}
      onReview={() => void prepare()}
      onTokenChange={(id) => {
        setChosenId(id);
        setAmount('');
        setReleaseReceipt(null);
      }}
      phase={phase}
      running={running}
      selectedId={selected?.id ?? ''}
      source={source}
      symbol={asset?.symbol ?? 'Token'}
      tokens={tokens}
    />
  );
}
