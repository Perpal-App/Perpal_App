import { isConnected, useEmbeddedSolanaWallet } from '@privy-io/expo';
import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { SkeletonText } from '@/components/feedback/Skeleton';
import { ActionButton } from '@/components/ui/ActionButton';
import { Button } from '@/components/ui/Button';
import { StatusRow } from '@/components/ui/StatusRow';
import { readAppConfig } from '@/config/appConfig';
import { parseAmount } from '@/domain/money/amount';
import type { WalletBalances } from '@/features/account/hooks/useWalletBalances';
import { WalletSwapConfirmationDialog } from '@/features/portfolio/components/WalletSwapConfirmationDialog';
import { useWalletSwapRecovery } from '@/features/portfolio/hooks/useWalletSwapRecovery';
import {
  formatSol,
  formatSwapAmount,
  formatSwapExpiry,
  maxConfirmationNotice,
  optionalSol,
  parseSwapInput,
  walletLabel,
} from '@/features/portfolio/components/walletSwapPresentation';
import {
  createPrivyVersionedTransactionAuthority,
  isPrivyWalletAddress,
} from '@/integrations/privy/privySolanaTransactionAuthority';
import {
  prepareMaximumWalletStablecoinSwap,
  prepareWalletStablecoinSwap,
  submitWalletStablecoinSwap,
  swapAssetDecimals,
  type SwapAsset,
  type WalletStablecoinSwapPlan,
  type WalletSwapScope,
} from '@/integrations/solana/walletStablecoinSwap';
import {
  captureInAppNotificationScope,
  publishInAppNotification,
} from '@/storage/inAppNotifications';
import { showAppToast } from '@/storage/appToast';
import { colors, radii, spacing, typography } from '@/theme/tokens';
import { useTradingSession } from '@/wallet/trading/TradingSessionProvider';

export function WalletSwapPanel({
  balances,
  initialScope = 'public',
  onBalancesChanged,
}: {
  readonly balances: WalletBalances | null;
  readonly initialScope?: WalletSwapScope;
  readonly onBalancesChanged: () => void;
}) {
  const config = readAppConfig();
  const embeddedWallet = useEmbeddedSolanaWallet();
  const session = useTradingSession();
  const [scope, setScope] = useState<WalletSwapScope>(initialScope);
  const [from, setFrom] = useState<SwapAsset>('USDC');
  const [amount, setAmount] = useState('');
  const [plan, setPlan] = useState<WalletStablecoinSwapPlan | null>(null);
  const [confirmationVisible, setConfirmationVisible] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'preparing' | 'submitting'>('idle');
  const prepareAbort = useRef<AbortController | null>(null);
  const submitInFlight = useRef(false);
  const to: SwapAsset = from === 'USDC' ? 'SOL' : 'USDC';
  const owner = scope === 'public' ? session.mainWalletAddress : session.address;
  const walletBalance = (scope === 'public'
    ? balances?.publicWallet
    : balances?.privateWallet) ?? null;
  const sourceBalance = walletBalance === null
    ? null
    : from === 'USDC'
      ? walletBalance.usdcBaseUnits
      : walletBalance.solLamports;
  const enteredBaseUnits = parseSwapInput(amount, from);
  const amountIsMax = plan?.amountMode === 'max';
  const amountExceedsBalance = sourceBalance !== null &&
    enteredBaseUnits !== null && enteredBaseUnits > sourceBalance;
  const recovery = useWalletSwapRecovery({
    onBalancesChanged,
    owner,
    rpcUrl: config.ok ? config.value.api.rpcUrl : null,
    signer: session.signer,
    walletLabel: walletLabel(scope),
  });
  const controlsLocked = phase !== 'idle' || recovery.blocked;

  const invalidate = useCallback(() => {
    prepareAbort.current?.abort();
    setConfirmationVisible(false);
    setPlan(null);
    setPhase('idle');
  }, []);

  useEffect(() => () => prepareAbort.current?.abort(), []);

  const selectScope = (next: WalletSwapScope) => {
    if (next === scope) return;
    invalidate();
    setScope(next);
    setAmount('');
  };

  const selectFrom = (next: SwapAsset) => {
    if (next === from) return;
    invalidate();
    setFrom(next);
    setAmount('');
  };

  const prepare = async (mode: 'exact' | 'max') => {
    if (!config.ok || owner === null || session.signer === null) {
      showAppToast({
        outcome: 'error',
        title: 'Swap unavailable',
        message: 'Wallet services are still getting ready.',
      });
      return;
    }

    let amountBaseUnits: bigint | null = null;
    try {
      if (balances === null || sourceBalance === null) {
        throw new Error('Wallet balances are still loading.');
      }
      if (mode === 'exact') {
        amountBaseUnits = parseAmount(amount, swapAssetDecimals(from)).baseUnits;
        if (amountBaseUnits <= 0n) throw new Error('Enter an amount greater than zero.');
        if (amountBaseUnits > sourceBalance) {
          throw new Error(`Available balance is ${formatSwapAmount(sourceBalance, from)} ${from}.`);
        }
      } else if (sourceBalance <= 0n) {
        throw new Error(`No ${from} is available to swap.`);
      }
    } catch (cause) {
      showAppToast({ outcome: 'error', title: 'Review swap', message: userMessage(cause) });
      return;
    }

    prepareAbort.current?.abort();
    const controller = new AbortController();
    prepareAbort.current = controller;
    setPhase('preparing');
    setPlan(null);
    try {
      const preparation = {
        from,
        owner,
        requestSigner: session.signer,
        rpcUrl: config.value.api.rpcUrl,
        scope,
        signal: controller.signal,
        swapBuildUrl: config.value.api.swapBuildUrl,
        usdcMint: config.value.perps.usdcMint,
      } as const;
      let next: WalletStablecoinSwapPlan;
      if (mode === 'max') {
        next = await prepareMaximumWalletStablecoinSwap(preparation);
      } else {
        if (amountBaseUnits === null) {
          throw new Error('Enter an amount greater than zero.');
        }
        next = await prepareWalletStablecoinSwap({
          ...preparation,
          amountBaseUnits,
        });
      }
      if (!controller.signal.aborted) {
        setAmount(formatSwapAmount(next.amountBaseUnits, next.from));
        setPlan(next);
        setPhase('idle');
      }
    } catch (cause) {
      if (!controller.signal.aborted) {
        logSwapFailure('preparation', cause);
        setPhase('idle');
        showAppToast({ outcome: 'error', title: 'Swap unavailable', message: userMessage(cause) });
      }
    }
  };

  const submit = async (confirmedPlan: WalletStablecoinSwapPlan) => {
    if (submitInFlight.current || recovery.isBlocked()) return;
    const notificationScope = captureInAppNotificationScope();
    if (!config.ok || session.signer === null) {
      setConfirmationVisible(false);
      showAppToast({
        outcome: 'error',
        title: 'Swap unavailable',
        message: 'Wallet services are still getting ready.',
      });
      return;
    }
    submitInFlight.current = true;
    setPhase('submitting');
    try {
      const transactionAuthority = confirmedPlan.scope === 'public'
        ? await publicTransactionAuthority(
            confirmedPlan.owner,
            embeddedWallet,
          )
        : undefined;
      const result = await submitWalletStablecoinSwap({
        plan: confirmedPlan,
        requestSigner: session.signer,
        rpcUrl: config.value.api.rpcUrl,
        ...(transactionAuthority === undefined ? {} : { transactionAuthority }),
      });
      const confirmed = result.status === 'confirmed';
      setPhase('idle');
      if (!confirmed) recovery.resume();
      setConfirmationVisible(false);
      setPlan(null);
      setAmount('');
      onBalancesChanged();
      publishInAppNotification({
        correlations: [{ namespace: 'solana-transaction', value: result.signature }],
        kind: 'wallet',
        outcome: confirmed ? 'success' : 'info',
        scopeToken: notificationScope,
        status: confirmed ? 'settled' : 'submitted',
        title: confirmed ? 'Swap complete' : 'Swap submitted',
        message: `${formatSwapAmount(confirmedPlan.amountBaseUnits, confirmedPlan.from)} ${confirmedPlan.from} → ${confirmedPlan.to}.`,
      });
    } catch (cause) {
      logSwapFailure('submission', cause);
      setPhase('idle');
      setConfirmationVisible(false);
      if (errorCode(cause) === 'quote_stale') setPlan(null);
      showAppToast({ outcome: 'error', title: 'Swap failed', message: userMessage(cause) });
      recovery.resume();
    } finally {
      submitInFlight.current = false;
    }
  };

  const confirm = () => {
    if (plan === null) return;
    setConfirmationVisible(true);
  };

  return (
    <View style={styles.container}>
      <View style={styles.headingBlock}>
        <Text accessibilityRole="header" style={styles.title}>Swap</Text>
        <Text style={styles.subtitle}>Exchange USDC and SOL in either wallet.</Text>
      </View>

      <View style={styles.controlBlock}>
        <Text style={styles.fieldLabel}>Wallet</Text>
        <View accessibilityRole="radiogroup" style={styles.selector}>
          {(['public', 'private'] as const).map((value) => (
            <ActionButton
              disabled={controlsLocked}
              key={value}
              label={walletLabel(value)}
              onPress={() => selectScope(value)}
              selected={scope === value}
              style={styles.selectorButton}
              tone={scope === value ? 'accent' : 'neutral'}
            />
          ))}
        </View>
      </View>

      <View style={styles.controlBlock}>
        <Text style={styles.fieldLabel}>From</Text>
        <View accessibilityRole="radiogroup" style={styles.selector}>
          {(['USDC', 'SOL'] as const).map((symbol) => (
            <ActionButton
              disabled={controlsLocked}
              key={symbol}
              label={symbol}
              onPress={() => selectFrom(symbol)}
              selected={from === symbol}
              style={styles.selectorButton}
              tone={from === symbol ? 'accent' : 'neutral'}
            />
          ))}
        </View>
      </View>

      <View style={styles.amountBlock}>
        <View style={styles.amountHeader}>
          <Text style={styles.fieldLabel}>You pay</Text>
          {sourceBalance === null ? (
            <SkeletonText align="right" role="caption" width={128} />
          ) : (
            <Text style={styles.balance}>
              Available {formatSwapAmount(sourceBalance, from)} {from}
            </Text>
          )}
        </View>
        <View style={styles.inputRow}>
          <TextInput
            accessibilityLabel={`Amount of ${from} to swap`}
            editable={!controlsLocked}
            keyboardType="decimal-pad"
            onChangeText={(value) => {
              invalidate();
              setAmount(value);
            }}
            placeholder="0"
            placeholderTextColor={colors.textMuted}
            selectionColor={colors.accentSoft}
            style={styles.input}
            value={amount}
          />
          <Text style={styles.symbol}>{from}</Text>
          <ActionButton
            disabled={controlsLocked || sourceBalance === null || sourceBalance === 0n}
            label="Max"
            onPress={() => void prepare('max')}
            style={styles.max}
            tone="neutral"
          />
        </View>
      </View>

      {amountExceedsBalance ? (
        <Text accessibilityLiveRegion="polite" style={styles.warning}>
          Available: {sourceBalance === null ? 'Loading' : formatSwapAmount(sourceBalance, from)} {from}
        </Text>
      ) : amountIsMax ? (
        <Text accessibilityLiveRegion="polite" style={styles.note}>
          {from === 'SOL'
            ? 'Max keeps the live network fee and required rent in SOL.'
            : 'Max uses the full USDC balance.'}
        </Text>
      ) : null}

      <StatusRow label="You receive" value={plan === null
        ? to
        : `${formatSwapAmount(plan.swap.minimumOutputBaseUnits, to)} ${to} minimum`} />
      {plan === null ? null : (
        <>
          <StatusRow label="Network fee" value={formatSol(plan.swap.feeLamports)} />
          <StatusRow label="SOL required" value={formatSol(plan.swap.requiredSolLamports)} />
          <StatusRow label="Maximum slippage" value="0.5%" />
          {plan.swap.persistentRentLamports > 0n ? (
            <Text style={styles.note}>
              Includes {formatSol(plan.swap.persistentRentLamports)} token-account rent.
            </Text>
          ) : null}
          {plan.swap.temporaryRentLamports > 0n ? (
            <Text style={styles.note}>
              {formatSol(plan.swap.temporaryRentLamports)} temporary WSOL rent is returned after the swap.
            </Text>
          ) : null}
        </>
      )}

      <Button
        disabled={
          recovery.blocked ||
          balances === null ||
          owner === null ||
          session.signer === null ||
          sourceBalance === null ||
          sourceBalance === 0n ||
          amountExceedsBalance ||
          (plan === null && (enteredBaseUnits === null || enteredBaseUnits <= 0n))
        }
        label={recovery.state === 'checking'
          ? 'Checking swap'
          : recovery.state === 'pending'
            ? 'Swap confirming'
            : plan === null ? 'Review swap' : 'Confirm swap'}
        loading={phase === 'preparing' || phase === 'submitting' || recovery.state === 'checking'}
        onPress={plan === null ? () => void prepare('exact') : confirm}
      />

      {plan === null ? null : (
        <WalletSwapConfirmationDialog
          estimatedEndingSol={formatSol(plan.swap.estimatedEndingSolLamports)}
          expiresAt={formatSwapExpiry(plan.expiresAtMs)}
          fee={formatSol(plan.swap.feeLamports)}
          loading={phase === 'submitting'}
          maxNotice={maxConfirmationNotice(plan)}
          minimumReceive={`${formatSwapAmount(plan.swap.minimumOutputBaseUnits, plan.to)} ${plan.to}`}
          onCancel={() => setConfirmationVisible(false)}
          onConfirm={() => void submit(plan)}
          persistentRent={optionalSol(plan.swap.persistentRentLamports)}
          slippage="0.5%"
          spend={`${formatSwapAmount(plan.amountBaseUnits, plan.from)} ${plan.from}`}
          temporaryRent={optionalSol(plan.swap.temporaryRentLamports)}
          temporaryRentRefundNote={plan.swap.temporaryRentLamports > 0n
            ? 'Temporary WSOL rent returns to this wallet when the swap closes its temporary account.'
            : null}
          title={`Review ${plan.from} → ${plan.to}`}
          visible={confirmationVisible}
          wallet={walletLabel(plan.scope)}
        />
      )}
    </View>
  );
}

async function publicTransactionAuthority(
  owner: string,
  wallet: ReturnType<typeof useEmbeddedSolanaWallet>,
) {
  if (!isConnected(wallet)) {
    throw new Error('The public wallet is not connected.');
  }

  const publicWallet = wallet.wallets.find(
    (candidate) => candidate.walletIndex === 0,
  );

  if (
    publicWallet === undefined ||
    !isPrivyWalletAddress(owner, publicWallet.address)
  ) {
    throw new Error('The active public wallet changed. Review a fresh swap.');
  }

  return createPrivyVersionedTransactionAuthority({
    address: owner,
    provider: await publicWallet.getProvider(),
  });
}

function userMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : 'The swap could not be prepared.';
}

function errorCode(cause: unknown): string | null {
  if (typeof cause !== 'object' || cause === null) return null;
  return typeof (cause as { readonly code?: unknown }).code === 'string'
    ? (cause as { readonly code: string }).code
    : null;
}

function logSwapFailure(phase: 'preparation' | 'submission', cause: unknown): void {
  if (!__DEV__) return;
  const error = cause as { readonly code?: unknown; readonly status?: unknown };
  console.info('[Perpal wallet swap failed]', {
    phase,
    errorName: cause instanceof Error ? cause.name : typeof cause,
    errorCode: typeof error?.code === 'string' ? error.code : 'unknown',
    status: typeof error?.status === 'number' ? error.status : 0,
  });
}

const styles = StyleSheet.create({
  container: { gap: spacing.md },
  headingBlock: { gap: spacing.xxs },
  title: { ...typography.heading, color: colors.textPrimary },
  subtitle: { ...typography.bodyCompact, color: colors.textSecondary },
  controlBlock: { gap: spacing.xs },
  selector: { flexDirection: 'row', gap: spacing.sm },
  selectorButton: { flex: 1 },
  amountBlock: { gap: spacing.xs },
  amountHeader: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm },
  fieldLabel: { ...typography.label, color: colors.textSecondary },
  balance: { ...typography.caption, color: colors.textMuted, textAlign: 'right', flexShrink: 1 },
  inputRow: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceElevated,
    paddingHorizontal: spacing.md,
  },
  input: { ...typography.heading, color: colors.textPrimary, flex: 1, paddingVertical: spacing.sm },
  symbol: { ...typography.label, color: colors.textSecondary },
  max: { minWidth: 64 },
  note: { ...typography.caption, color: colors.textMuted },
  warning: { ...typography.caption, color: colors.negative },
});
