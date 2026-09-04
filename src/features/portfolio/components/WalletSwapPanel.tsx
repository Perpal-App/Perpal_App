import { isConnected, useEmbeddedSolanaWallet } from '@privy-io/expo';
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
  createPrivyVersionedTransactionAuthority,
  isPrivyWalletAddress,
} from '@/integrations/privy/privySolanaTransactionAuthority';
import {
  prepareWalletStablecoinSwap,
  submitWalletStablecoinSwap,
  type Stablecoin,
  type WalletStablecoinSwapPlan,
  type WalletSwapScope,
} from '@/integrations/solana/walletStablecoinSwap';
import { publishInAppNotification } from '@/storage/inAppNotifications';
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
  const [from, setFrom] = useState<Stablecoin>('USDC');
  const [amount, setAmount] = useState('');
  const [plan, setPlan] = useState<WalletStablecoinSwapPlan | null>(null);
  const [phase, setPhase] = useState<'idle' | 'preparing' | 'submitting' | 'pending'>('idle');
  const prepareAbort = useRef<AbortController | null>(null);
  const to: Stablecoin = from === 'USDC' ? 'USDT' : 'USDC';
  const owner = scope === 'public' ? session.mainWalletAddress : session.address;
  const walletBalance = scope === 'public'
    ? balances?.publicWallet
    : balances?.privateWallet;
  const sourceBalance = from === 'USDC'
    ? walletBalance?.usdcBaseUnits ?? 0n
    : walletBalance?.usdtBaseUnits ?? 0n;
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
    if (!config.ok || owner === null || session.signer === null) return;
    const controller = new AbortController();
    void reconcilePendingTradeAction({
      owner,
      provider: 'wallet',
      rpcUrl: config.value.api.rpcUrl,
      signal: controller.signal,
      signer: session.signer,
    }).then((status) => {
      if (controller.signal.aborted || status === 'none' || status === 'expired') return;
      if (status === 'confirmed') {
        showAppToast({
          outcome: 'success',
          title: 'Swap confirmed',
          message: `${walletLabel(scope)} balances were updated.`,
        });
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
  }, [config, onBalancesChanged, owner, scope, session.signer]);

  const selectScope = (next: WalletSwapScope) => {
    if (next === scope) return;
    invalidate();
    setScope(next);
    setAmount('');
  };

  const selectFrom = (next: Stablecoin) => {
    if (next === from) return;
    invalidate();
    setFrom(next);
    setAmount('');
  };

  const prepare = async () => {
    if (!config.ok || owner === null || session.signer === null) {
      showAppToast({
        outcome: 'error',
        title: 'Swap unavailable',
        message: 'Wallet services are still getting ready.',
      });
      return;
    }

    let amountBaseUnits: bigint;
    try {
      amountBaseUnits = parseAmount(amount, 6).baseUnits;
      if (amountBaseUnits <= 0n) throw new Error('Enter an amount greater than zero.');
      if (balances === null) throw new Error('Wallet balances are still loading.');
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
      const next = await prepareWalletStablecoinSwap({
        amountBaseUnits,
        from,
        owner,
        requestSigner: session.signer,
        rpcUrl: config.value.api.rpcUrl,
        scope,
        signal: controller.signal,
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

  const submit = async (confirmedPlan: WalletStablecoinSwapPlan) => {
    if (!config.ok || session.signer === null) return;
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
      setPhase(confirmed ? 'idle' : 'pending');
      setPlan(null);
      setAmount('');
      onBalancesChanged();
      publishInAppNotification({
        kind: 'wallet',
        outcome: confirmed ? 'success' : 'info',
        title: confirmed ? 'Swap complete' : 'Swap submitted',
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
      `Wallet: ${walletLabel(plan.scope)}\n` +
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
        <Text accessibilityRole="header" style={styles.title}>Swap stablecoins</Text>
        <Text style={styles.subtitle}>Exchange USDC and USDT in either wallet.</Text>
      </View>

      <View style={styles.controlBlock}>
        <Text style={styles.fieldLabel}>Wallet</Text>
        <View accessibilityRole="radiogroup" style={styles.selector}>
          {(['public', 'private'] as const).map((value) => (
            <ActionButton
              disabled={phase !== 'idle'}
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
          {(['USDC', 'USDT'] as const).map((symbol) => (
            <ActionButton
              disabled={phase !== 'idle'}
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
            disabled={phase !== 'idle'}
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
          Max converts the full {from} balance. SOL remains reserved for fees.
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
        disabled={
          phase === 'pending' ||
          balances === null ||
          owner === null ||
          session.signer === null ||
          sourceBalance === 0n ||
          amountExceedsBalance
        }
        label={phase === 'pending' ? 'Swap confirming' : plan === null ? 'Review swap' : 'Confirm swap'}
        loading={phase === 'preparing' || phase === 'submitting'}
        onPress={plan === null ? () => void prepare() : confirm}
      />
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

function walletLabel(scope: WalletSwapScope): string {
  return scope === 'public' ? 'Public wallet' : 'Private wallet';
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
  return cause instanceof Error ? cause.message : 'The swap could not be prepared.';
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
