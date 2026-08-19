import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, StyleSheet, Text, TextInput, View } from 'react-native';

import { ActionButton } from '@/components/ui/ActionButton';
import { Button } from '@/components/ui/Button';
import { StatusRow } from '@/components/ui/StatusRow';
import { readAppConfig } from '@/config/appConfig';
import { amountFromBaseUnits, formatAmount, parseAmount } from '@/domain/money/amount';
import type { WalletBalances } from '@/features/account/hooks/useWalletBalances';
import { reconcilePendingTradeAction } from '@/integrations/perps/tradeActionRecovery';
import {
  preparePrivateWalletSwap,
  submitPrivateWalletSwap,
  type PrivateStablecoin,
  type PrivateWalletSwapPlan,
} from '@/integrations/solana/privateWalletSwap';
import { publishInAppNotification } from '@/storage/inAppNotifications';
import { showAppToast } from '@/storage/appToast';
import { colors, radii, spacing, typography } from '@/theme/tokens';
import { useTradingSession } from '@/wallet/trading/TradingSessionProvider';

export function PrivateSwapPanel({
  balances,
  onBalancesChanged,
}: {
  readonly balances: WalletBalances | null;
  readonly onBalancesChanged: () => void;
}) {
  const config = readAppConfig();
  const session = useTradingSession();
  const [from, setFrom] = useState<PrivateStablecoin>('USDC');
  const [amount, setAmount] = useState('');
  const [plan, setPlan] = useState<PrivateWalletSwapPlan | null>(null);
  const [phase, setPhase] = useState<'idle' | 'preparing' | 'submitting' | 'pending'>('idle');
  const prepareAbort = useRef<AbortController | null>(null);
  const to: PrivateStablecoin = from === 'USDC' ? 'USDT' : 'USDC';
  const sourceBalance = from === 'USDC'
    ? balances?.privateWallet.usdcBaseUnits ?? 0n
    : balances?.privateWallet.usdtBaseUnits ?? 0n;
  const enteredBaseUnits = enteredAmount(amount);
  const amountIsMax = sourceBalance > 0n && enteredBaseUnits === sourceBalance;
  const amountExceedsBalance = enteredBaseUnits !== null && enteredBaseUnits > sourceBalance;

  const invalidate = useCallback(() => {
    prepareAbort.current?.abort();
    setPlan(null);
    setPhase('idle');
  }, []);

  useEffect(() => () => prepareAbort.current?.abort(), []);

  useEffect(() => {
    if (!config.ok || session.address === null || session.signer === null) return;
    const controller = new AbortController();
    void reconcilePendingTradeAction({
      owner: session.address,
      provider: 'wallet',
      rpcUrl: config.value.api.rpcUrl,
      signal: controller.signal,
      signer: session.signer,
    }).then((status) => {
      if (controller.signal.aborted || status === 'none' || status === 'expired') return;
      if (status === 'confirmed') {
        showAppToast({ outcome: 'success', title: 'Swap confirmed', message: 'Private balances were updated.' });
        onBalancesChanged();
        return;
      }
      setPhase('pending');
      showAppToast({ outcome: 'info', title: 'Swap confirming', message: 'The signed swap was not submitted again.' });
    }).catch((cause) => {
      if (!controller.signal.aborted) {
        showAppToast({ outcome: 'error', title: 'Swap recovery paused', message: userMessage(cause) });
      }
    });
    return () => controller.abort();
  }, [config, onBalancesChanged, session.address, session.signer]);

  const selectFrom = (next: PrivateStablecoin) => {
    if (next === from) return;
    invalidate();
    setFrom(next);
    setAmount('');
  };

  const prepare = async () => {
    if (!config.ok || session.address === null || session.signer === null) {
      showAppToast({ outcome: 'error', title: 'Swap unavailable', message: 'Private wallet T is not ready.' });
      return;
    }

    let amountBaseUnits: bigint;
    try {
      amountBaseUnits = parseAmount(amount, 6).baseUnits;
      if (amountBaseUnits <= 0n) throw new Error('Enter an amount greater than zero.');
      if (balances === null) throw new Error('Private balances are still loading.');
      if (amountBaseUnits > sourceBalance) {
        throw new Error(`Available balance is ${token(sourceBalance)} ${from}.`);
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
      const next = await preparePrivateWalletSwap({
        amountBaseUnits,
        from,
        owner: session.address,
        rpcUrl: config.value.api.rpcUrl,
        signal: controller.signal,
        signer: session.signer,
        swapBuildUrl: config.value.api.swapBuildUrl,
        usdcMint: config.value.perps.usdcMint,
        usdtMint: config.value.perps.usdtMint,
      });
      if (!controller.signal.aborted) {
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

  const submit = async (confirmedPlan: PrivateWalletSwapPlan) => {
    if (!config.ok || session.address === null || session.signer === null) return;
    setPhase('submitting');
    try {
      const result = await submitPrivateWalletSwap({
        owner: session.address,
        plan: confirmedPlan,
        rpcUrl: config.value.api.rpcUrl,
        signer: session.signer,
      });
      const confirmed = result.status === 'confirmed';
      setPhase(confirmed ? 'idle' : 'pending');
      setPlan(null);
      setAmount('');
      onBalancesChanged();
      publishInAppNotification({
        kind: 'wallet',
        outcome: confirmed ? 'success' : 'info',
        title: confirmed ? 'Private swap complete' : 'Private swap submitted',
        message: `${token(confirmedPlan.amountBaseUnits)} ${confirmedPlan.from} → ${confirmedPlan.to}.`,
      });
    } catch (cause) {
      logSwapFailure('submission', cause);
      setPhase('idle');
      showAppToast({ outcome: 'error', title: 'Swap failed', message: userMessage(cause) });
    }
  };

  const confirm = () => {
    if (plan === null) return;
    const maxNotice = plan.amountBaseUnits === plan.sourceBalanceBaseUnits
      ? `\nThis converts the full ${plan.from} token balance.`
      : '';
    const rentNotice = plan.swap.rentLamports > 0n
      ? `\nToken-account rent: ${sol(plan.swap.rentLamports)}`
      : '';
    Alert.alert(
      `Swap ${plan.from} to ${plan.to}?`,
      `Spend: ${token(plan.amountBaseUnits)} ${plan.from}\n` +
      `Receive at least: ${token(plan.swap.minimumOutputBaseUnits)} ${plan.to}\n` +
      `Network fee: ${sol(plan.swap.feeLamports)}${rentNotice}\n` +
      `Maximum slippage: 0.5%${maxNotice}`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Confirm and sign', onPress: () => void submit(plan) },
      ],
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.headingBlock}>
        <Text accessibilityRole="header" style={styles.title}>Swap private funds</Text>
        <Text style={styles.subtitle}>Exchange USDC and USDT inside private wallet T.</Text>
      </View>

      <View accessibilityRole="radiogroup" style={styles.selector}>
        {(['USDC', 'USDT'] as const).map((symbol) => (
          <ActionButton
            key={symbol}
            label={symbol}
            onPress={() => selectFrom(symbol)}
            selected={from === symbol}
            style={styles.selectorButton}
            tone={from === symbol ? 'accent' : 'neutral'}
          />
        ))}
      </View>

      <View style={styles.amountBlock}>
        <View style={styles.amountHeader}>
          <Text style={styles.fieldLabel}>You pay</Text>
          <Text style={styles.balance}>Available {token(sourceBalance)} {from}</Text>
        </View>
        <View style={styles.inputRow}>
          <TextInput
            accessibilityLabel={`Amount of ${from} to swap`}
            editable={phase === 'idle'}
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
            label="Max"
            onPress={() => {
              invalidate();
              setAmount(token(sourceBalance));
            }}
            style={styles.max}
            tone="neutral"
          />
        </View>
      </View>

      {amountExceedsBalance ? (
        <Text accessibilityLiveRegion="polite" style={styles.warning}>
          Available: {token(sourceBalance)} {from}
        </Text>
      ) : amountIsMax ? (
        <Text accessibilityLiveRegion="polite" style={styles.note}>
          Max converts the full {from} balance. SOL stays in T for fees.
        </Text>
      ) : null}

      <StatusRow label="You receive" value={plan === null
        ? to
        : `${token(plan.swap.minimumOutputBaseUnits)} ${to} minimum`} />
      {plan === null ? null : (
        <>
          <StatusRow label="Network fee" value={sol(plan.swap.feeLamports)} />
          <StatusRow label="SOL required" value={sol(plan.swap.requiredSolLamports)} />
          <StatusRow label="Maximum slippage" value="0.5%" />
          {plan.swap.createsTokenAccount ? (
            <Text style={styles.note}>
              Includes {sol(plan.swap.rentLamports)} first-time token-account rent.
            </Text>
          ) : null}
        </>
      )}

      <Button
        disabled={phase === 'pending' || balances === null || sourceBalance === 0n || amountExceedsBalance}
        label={phase === 'pending' ? 'Swap confirming' : plan === null ? 'Review swap' : 'Confirm swap'}
        loading={phase === 'preparing' || phase === 'submitting'}
        onPress={plan === null ? () => void prepare() : confirm}
      />
    </View>
  );
}

function token(value: bigint): string {
  return formatAmount(amountFromBaseUnits(value, 6));
}

function sol(value: bigint): string {
  return `${formatAmount(amountFromBaseUnits(value, 9))} SOL`;
}

function enteredAmount(value: string): bigint | null {
  try {
    return parseAmount(value, 6).baseUnits;
  } catch {
    return null;
  }
}

function userMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : 'The private swap could not be prepared.';
}

function logSwapFailure(phase: 'preparation' | 'submission', cause: unknown): void {
  if (!__DEV__) return;
  const error = cause as { readonly code?: unknown; readonly status?: unknown };
  console.info('[Perpal private swap failed]', {
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
