import { isConnected, useEmbeddedSolanaWallet } from '@privy-io/expo';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { ActionButton } from '@/components/ui/ActionButton';
import { amountFromBaseUnits, formatAmount, parseAmount } from '@/domain/money/amount';
import type { WalletBalances } from '@/features/account/hooks/useWalletBalances';
import { WithdrawReviewStep } from '@/features/portfolio/components/WithdrawReviewStep';
import {
  WITHDRAW_RADIUS,
  withdrawSheetStyles,
} from '@/features/portfolio/components/withdrawSheetStyles';
import { readAppConfig } from '@/config/appConfig';
import { PACIFICA_MINIMUM_CREDITED_DEPOSIT_BASE_UNITS } from '@/integrations/perps/pacifica/pacificaDeposit';
import {
  fastDepositErrorMessage,
  prepareFastPacificaDeposit,
  submitFastPacificaDeposit,
  type FastPacificaDepositPlan,
} from '@/integrations/perps/pacifica/pacificaFastDeposit';
import { waitForPacificaDepositCredit } from '@/integrations/perps/pacifica/pacificaDepositSettlement';
import { reconcilePendingTradeAction } from '@/integrations/perps/tradeActionRecovery';
import {
  createPrivyMultiAuthorityLegacySigner,
  isPrivyWalletAddress,
} from '@/integrations/privy/privySolanaTransactionAuthority';
import {
  captureInAppNotificationScope,
  publishInAppNotification,
} from '@/storage/inAppNotifications';
import { showAppToast } from '@/storage/appToast';
import { colors, spacing, typography } from '@/theme/tokens';
import { useTradingSession } from '@/wallet/trading/TradingSessionProvider';

const USDC_DECIMALS = 6;

export function FastPacificaFundingPanel({
  balances,
  onBalancesChanged,
  onBusyChange,
  onPacificaRefresh,
  onReviewingChange,
}: {
  readonly balances: WalletBalances | null;
  readonly onBalancesChanged: () => void;
  readonly onBusyChange: (busy: boolean) => void;
  readonly onPacificaRefresh: () => void;
  readonly onReviewingChange: (reviewing: boolean) => void;
}) {
  const config = readAppConfig();
  const wallet = useEmbeddedSolanaWallet();
  const session = useTradingSession();
  const [amount, setAmount] = useState('');
  const [phase, setPhase] = useState<'idle' | 'preparing' | 'reviewing' | 'submitting' | 'pending'>(
    'idle',
  );
  const [plan, setPlan] = useState<FastPacificaDepositPlan | null>(null);
  const controller = useRef<AbortController | null>(null);
  const submitInFlight = useRef(false);
  const prefilledMinimum = useRef(false);
  const publicUsdc = balances?.publicWallet?.usdcBaseUnits ?? null;
  const stagedUsdc = balances?.privateWallet?.usdcBaseUnits ?? null;
  const busy = phase !== 'idle';

  useEffect(() => () => controller.current?.abort(), []);
  useLayoutEffect(() => onReviewingChange(plan !== null), [onReviewingChange, plan]);
  useEffect(() => onBusyChange(busy), [busy, onBusyChange]);

  // The trade-entry path knows the action is blocked by Pacifica's minimum. Fill only the missing public
  // top-up once both balances are known, so 1 staged USDC opens at 9 rather than asking the reader to do
  // that arithmetic or accidentally adding another full 10. Any edit after this is left untouched.
  useEffect(() => {
    if (
      prefilledMinimum.current ||
      amount.length > 0 ||
      publicUsdc === null ||
      stagedUsdc === null
    ) return;
    prefilledMinimum.current = true;
    const minimumTopUp = stagedUsdc >= PACIFICA_MINIMUM_CREDITED_DEPOSIT_BASE_UNITS
      ? 0n
      : PACIFICA_MINIMUM_CREDITED_DEPOSIT_BASE_UNITS - stagedUsdc;
    if (minimumTopUp > 0n) setAmount(token(minimumTopUp));
  }, [amount.length, publicUsdc, stagedUsdc]);

  // A fully signed operation can outlive this sheet. Reconcile it on mount and keep checking while its
  // chain/indexing lock exists; the root monitor removes that lock only after Pacifica reflects credit.
  useEffect(() => {
    if (
      !config.ok ||
      session.address === null ||
      session.signer === null ||
      (phase !== 'idle' && phase !== 'pending')
    ) return undefined;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      const status = await reconcilePendingTradeAction({
        owner: session.address!,
        provider: 'pacifica',
        rpcUrl: config.value.api.rpcUrl,
        signal: abort.signal,
        signer: session.signer!,
      }).catch(() => 'pending' as const);
      if (abort.signal.aborted) return;
      if (status === 'pending' || status === 'indexing') {
        setPhase('pending');
        timer = setTimeout(() => void poll(), 3_000);
        return;
      }
      if (phase === 'pending') {
        setPlan(null);
        setAmount('');
        setPhase('idle');
        onBalancesChanged();
        onPacificaRefresh();
      }
    };
    void poll();
    return () => {
      abort.abort();
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [config, onBalancesChanged, onPacificaRefresh, phase, session.address, session.signer]);

  const prepare = async () => {
    if (
      !config.ok ||
      session.status !== 'ready' ||
      session.address === null ||
      session.mainWalletAddress === null ||
      session.signer === null
    ) {
      showAppToast({ outcome: 'error', message: 'Funding wallets are still loading.' });
      return;
    }

    let baseUnits: bigint;
    try {
      baseUnits = parseAmount(amount, USDC_DECIMALS).baseUnits;
      if (baseUnits <= 0n) throw new Error('invalid');
    } catch {
      showAppToast({ outcome: 'error', message: 'Enter a valid USDC amount.' });
      return;
    }

    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setPhase('preparing');
    try {
      const recovery = await reconcilePendingTradeAction({
        owner: session.address,
        provider: 'pacifica',
        rpcUrl: config.value.api.rpcUrl,
        signal: abort.signal,
        signer: session.signer,
      });
      if (recovery === 'pending' || recovery === 'indexing') {
        setPhase('pending');
        showAppToast({ outcome: 'info', message: 'A Pacifica deposit is still settling.' });
        return;
      }
      const next = await prepareFastPacificaDeposit({
        amountBaseUnits: baseUnits,
        apiOrigin: config.value.perps.pacificaApiOrigin,
        centralState: config.value.perps.pacificaCentralState,
        mint: config.value.perps.usdcMint,
        programId: config.value.perps.pacificaProgramId,
        publicWalletAddress: session.mainWalletAddress,
        rpcUrl: config.value.api.rpcUrl,
        signal: abort.signal,
        signer: session.signer,
        tradingWalletAddress: session.address,
        vault: config.value.perps.pacificaVault,
      });
      if (abort.signal.aborted) return;
      setPlan(next);
      setPhase('reviewing');
    } catch (cause) {
      if (!abort.signal.aborted) {
        setPhase('idle');
        showAppToast({ outcome: 'error', message: fastDepositErrorMessage(cause) });
      }
    }
  };

  const submit = async (confirmed: FastPacificaDepositPlan) => {
    if (
      !config.ok ||
      session.signer === null ||
      submitInFlight.current ||
      !isConnected(wallet)
    ) return;
    const publicWallet = wallet.wallets.find((candidate) => candidate.walletIndex === 0);
    if (
      publicWallet === undefined ||
      !isPrivyWalletAddress(confirmed.publicWalletAddress, publicWallet.address)
    ) {
      showAppToast({ outcome: 'error', message: 'The active public wallet changed.' });
      return;
    }

    submitInFlight.current = true;
    const notificationScope = captureInAppNotificationScope();
    const abort = new AbortController();
    controller.current = abort;
    setPhase('submitting');
    let submitted = false;
    try {
      const publicSigner = createPrivyMultiAuthorityLegacySigner({
        address: confirmed.publicWalletAddress,
        coSignerAddress: confirmed.tradingWalletAddress,
        provider: await publicWallet.getProvider(),
      });
      const result = await submitFastPacificaDeposit({
        plan: confirmed,
        publicSigner,
        rpcUrl: config.value.api.rpcUrl,
        signal: abort.signal,
        signer: session.signer,
      });
      submitted = true;
      if (result.status !== 'confirmed') {
        setPhase('pending');
        publishInAppNotification({
          correlations: [{ namespace: 'solana-transaction', value: result.signature }],
          kind: 'funding',
          message: 'Waiting for Solana and Pacifica. Do not deposit again.',
          outcome: 'info',
          scopeToken: notificationScope,
          status: 'submitted',
          title: 'Fast deposit submitted',
        });
        return;
      }

      setPhase('pending');
      const settlement = await waitForPacificaDepositCredit({
        account: confirmed.tradingWalletAddress,
        apiOrigin: config.value.perps.pacificaApiOrigin,
        rpcUrl: config.value.api.rpcUrl,
        signal: abort.signal,
        signer: session.signer,
      });
      if (settlement.status !== 'credited') {
        publishInAppNotification({
          correlations: [{ namespace: 'solana-transaction', value: result.signature }],
          kind: 'funding',
          message: 'Transfer confirmed. Pacifica is crediting the balance.',
          outcome: 'info',
          scopeToken: notificationScope,
          status: 'submitted',
          title: 'Fast deposit settling',
        });
        return;
      }

      setAmount('');
      setPlan(null);
      setPhase('idle');
      onBalancesChanged();
      onPacificaRefresh();
      publishInAppNotification({
        correlations: [{ namespace: 'solana-transaction', value: result.signature }],
        kind: 'funding',
        message: 'USDC is available for trading.',
        outcome: 'success',
        scopeToken: notificationScope,
        status: 'settled',
        title: 'Fast deposit credited',
      });
    } catch (cause) {
      if (!abort.signal.aborted) {
        setPhase(submitted ? 'pending' : 'reviewing');
        showAppToast({ outcome: 'error', message: fastDepositErrorMessage(cause) });
      }
    } finally {
      submitInFlight.current = false;
    }
  };

  if (plan !== null) {
    return (
      <WithdrawReviewStep
        confirming={phase === 'submitting' || phase === 'pending'}
        headline={`${token(plan.amountBaseUnits)} USDC`}
        note="Public on Solana. Your public and trading wallets are linkable."
        onBack={() => {
          controller.current?.abort();
          setPlan(null);
          setPhase('idle');
        }}
        onConfirm={() => void submit(plan)}
        rows={[
          { label: 'Public top-up', value: `${token(plan.publicTransferBaseUnits)} USDC` },
          ...(plan.stagedUsdcBaseUnits > 0n
            ? [{ label: 'Staged included', value: `${token(plan.stagedUsdcBaseUnits)} USDC` }]
            : []),
          { label: 'To', value: 'Pacifica trading balance' },
          { label: 'Network fee', value: `${sol(plan.feeLamports)} SOL` },
          ...(plan.rentLamports > 0n
            ? [{ label: 'Account rent', value: `${sol(plan.rentLamports)} SOL` }]
            : []),
        ]}
        slideLabel="Slide to deposit"
        title="Review fast deposit"
        workingLabel="Depositing"
      />
    );
  }

  return (
    <View style={styles.panel}>
      <Text style={styles.note}>One atomic transaction. Publicly links both wallets.</Text>
      <View style={styles.field}>
        <View style={styles.fieldHead}>
          <Text style={styles.label}>Amount</Text>
          {publicUsdc === null ? null : (
            <Text numberOfLines={1} style={styles.available}>
              {token(publicUsdc)} USDC available
            </Text>
          )}
        </View>
        <View style={styles.row}>
          <TextInput
            accessibilityLabel="Fast deposit USDC amount"
            editable={!busy}
            inputMode="decimal"
            onChangeText={setAmount}
            placeholder="10.00"
            placeholderTextColor={colors.textMuted}
            style={[withdrawSheetStyles.input, styles.input]}
            value={amount}
          />
          <ActionButton
            disabled={busy || publicUsdc === null}
            label="Max"
            onPress={() => {
              if (publicUsdc !== null) setAmount(token(publicUsdc));
            }}
            radius={WITHDRAW_RADIUS}
            tone="neutral"
          />
        </View>
        <Text style={styles.hint}>
          {stagedUsdc === null
            ? 'Checking staged USDC'
            : stagedUsdc >= PACIFICA_MINIMUM_CREDITED_DEPOSIT_BASE_UNITS
              ? 'Staged balance already meets the 10 USDC minimum'
              : `Minimum top-up ${token(
                PACIFICA_MINIMUM_CREDITED_DEPOSIT_BASE_UNITS - stagedUsdc,
              )} USDC`}
        </Text>
      </View>
      <ActionButton
        disabled={busy || publicUsdc === null || stagedUsdc === null}
        label={phase === 'preparing'
          ? 'Checking deposit'
          : phase === 'pending'
            ? 'Pacifica crediting funds'
            : 'Review fast deposit'}
        loading={phase === 'preparing' || phase === 'pending'}
        onPress={() => void prepare()}
      />
    </View>
  );
}

function token(baseUnits: bigint): string {
  return formatAmount(amountFromBaseUnits(baseUnits, USDC_DECIMALS));
}

function sol(lamports: bigint): string {
  return formatAmount(amountFromBaseUnits(lamports, 9));
}

const styles = StyleSheet.create({
  panel: { gap: spacing.md },
  note: { ...typography.caption, color: colors.textSecondary },
  field: { gap: spacing.xs },
  fieldHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  label: { ...typography.label, color: colors.textSecondary },
  available: {
    ...typography.caption,
    flexShrink: 1,
    color: colors.textSecondary,
    fontVariant: ['tabular-nums'],
  },
  row: { flexDirection: 'row', alignItems: 'stretch', gap: spacing.xs },
  input: { flex: 1, minWidth: 0 },
  hint: { ...typography.caption, color: colors.textMuted },
});
