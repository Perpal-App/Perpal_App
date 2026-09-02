import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, StyleSheet, Text, TextInput, View } from 'react-native';
import { NATIVE_MINT } from '@solana/spl-token';
import { PublicKey } from '@solana/web3.js';

import { ActionButton } from '@/components/ui/ActionButton';
import { readAppConfig } from '@/config/appConfig';
import type { WalletBalances } from '@/features/account/hooks/useWalletBalances';
import {
  formatTokenAmount,
  parseTokenAmount,
  TokenSelector,
  type WithdrawableToken,
} from '@/features/portfolio/components/PrivateWithdrawPanel';
import { listTradingCollateralOptions } from '@/integrations/perps/providerCollateral';
import { reconcilePendingTradeAction } from '@/integrations/perps/tradeActionRecovery';
import {
  DirectWithdrawalError,
  prepareDirectWithdrawal,
  submitDirectWithdrawal,
  type DirectWithdrawalPlan,
} from '@/integrations/solana/directWithdrawal';
import { TransactionSigningError } from '@/integrations/solana/signedLegacyTransaction';
import type { PrivateExitAsset } from '@/integrations/umbra/PrivateExitProvider';
import { publishInAppNotification } from '@/storage/inAppNotifications';
import { showAppToast } from '@/storage/appToast';
import { colors, layout, radii, spacing, typography } from '@/theme/tokens';
import { useTradingSession } from '@/wallet/trading/TradingSessionProvider';

type Phase = 'idle' | 'quoting' | 'preparing' | 'reviewing' | 'submitting' | 'pending';

export function DirectWithdrawPanel({
  balances,
  mainWalletAddress,
  onBalancesChanged,
}: {
  readonly balances: WalletBalances | null;
  readonly mainWalletAddress: string | null;
  readonly onBalancesChanged: () => void;
}) {
  const config = readAppConfig();
  const session = useTradingSession();
  const [amount, setAmount] = useState('');
  const [chosenId, setChosenId] = useState('');
  const [destinationMode, setDestinationMode] = useState<'privy' | 'external'>('privy');
  const [externalAddress, setExternalAddress] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [withdrawMaximum, setWithdrawMaximum] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const tokens = useMemo(() => directTokens(balances), [balances]);
  const selected = tokens.find((token) => token.id === chosenId) ?? tokens[0] ?? null;
  const asset = selected?.asset ?? null;
  const availableBaseUnits = selected?.baseUnits ?? null;
  const running = phase !== 'idle';

  useEffect(() => () => controller.current?.abort(), []);

  useEffect(() => {
    if (!config.ok || session.address === null || session.signer === null) return;
    const abort = new AbortController();
    void reconcilePendingTradeAction({
      owner: session.address,
      provider: 'wallet-withdrawal',
      rpcUrl: config.value.api.rpcUrl,
      signal: abort.signal,
      signer: session.signer,
    }).then((status) => {
      if (abort.signal.aborted || status === 'none') return;
      onBalancesChanged();
      if (status === 'confirmed') {
        setPhase('idle');
        publishInAppNotification({
          kind: 'withdrawal', outcome: 'success', title: 'Direct withdrawal confirmed',
          message: 'The destination received the transfer and wallet balances were refreshed.',
        });
      } else if (status === 'pending') {
        setPhase('pending');
        showAppToast({
          outcome: 'info', title: 'Withdrawal confirming',
          message: 'No balance is hidden or deducted locally while Solana confirms the transfer.',
        });
      } else {
        setPhase('idle');
        showAppToast({
          outcome: 'info', title: 'Withdrawal not confirmed',
          message: 'The signed transfer expired. The amount remains in your private balance.',
        });
      }
    }).catch((cause) => {
      if (abort.signal.aborted) return;
      setPhase('idle');
      onBalancesChanged();
      publishInAppNotification({
        kind: 'withdrawal', outcome: 'error', title: 'Direct withdrawal failed',
        message: directErrorMessage(cause),
      });
    });
    return () => abort.abort();
  }, [config, onBalancesChanged, session.address, session.signer]);

  const prepare = async (
    quoteOnly = false,
    maximum = withdrawMaximum,
  ) => {
    if (
      !config.ok ||
      session.status !== 'ready' ||
      session.address === null ||
      session.signer === null ||
      asset === null ||
      availableBaseUnits === null
    ) {
      showAppToast({
        outcome: 'error', title: 'Withdrawal unavailable',
        message: 'Private wallet balances are still loading.',
      });
      return;
    }

    let amountBaseUnits: bigint | 'max';
    let destinationAddress: string;
    try {
      amountBaseUnits = maximum ? 'max' : parseTokenAmount(amount, asset.decimals);
      destinationAddress = new PublicKey(
        destinationMode === 'privy' ? mainWalletAddress ?? '' : externalAddress.trim(),
      ).toBase58();
      if (amountBaseUnits !== 'max' && (
        amountBaseUnits <= 0n || amountBaseUnits > availableBaseUnits
      )) {
        throw new Error('invalid amount');
      }
    } catch {
      showAppToast({
        outcome: 'error', title: 'Review withdrawal',
        message: `Enter up to ${formatTokenAmount(availableBaseUnits, asset.decimals)} ${asset.symbol} and a valid wallet.`,
      });
      return;
    }

    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setPhase(quoteOnly ? 'quoting' : 'preparing');
    try {
      const pending = await reconcilePendingTradeAction({
        owner: session.address,
        provider: 'wallet-withdrawal',
        rpcUrl: config.value.api.rpcUrl,
        signal: abort.signal,
        signer: session.signer,
      });
      if (pending === 'pending') {
        setPhase('pending');
        showAppToast({
          outcome: 'info', title: 'Withdrawal confirming',
          message: 'Wait for the existing signed withdrawal to settle before preparing another.',
        });
        return;
      }
      if (pending === 'confirmed') {
        setPhase('idle');
        onBalancesChanged();
        showAppToast({
          outcome: 'success', title: 'Previous withdrawal confirmed',
          message: 'Balances were refreshed. Review the next amount again.',
        });
        return;
      }

      const plan = await prepareDirectWithdrawal({
        amountBaseUnits,
        decimals: asset.decimals,
        destinationAddress,
        kind: asset.kind,
        mint: asset.mint,
        owner: session.address,
        rpcUrl: config.value.api.rpcUrl,
        signal: abort.signal,
        signer: session.signer,
        symbol: asset.symbol,
      });
      if (abort.signal.aborted) return;
      if (quoteOnly) {
        setAmount(formatTokenAmount(plan.amountBaseUnits, plan.decimals));
        setWithdrawMaximum(true);
        setPhase('idle');
        showAppToast({
          outcome: 'info',
          title: 'Maximum calculated',
          message: maxCostMessage(plan),
        });
        return;
      }
      review(plan);
    } catch (cause) {
      if (!abort.signal.aborted) {
        setPhase('idle');
        onBalancesChanged();
        showAppToast({ outcome: 'error', title: 'Withdrawal unavailable', message: directErrorMessage(cause) });
      }
    }
  };

  const review = (plan: DirectWithdrawalPlan) => {
    setPhase('reviewing');
    const rent = plan.rentLamports > 0n
      ? `\nDestination token-account rent: ${sol(plan.rentLamports)}`
      : '';
    Alert.alert(
      `Send ${plan.symbol} directly?`,
      `Amount: ${formatTokenAmount(plan.amountBaseUnits, plan.decimals)} ${plan.symbol}\n` +
      `Destination: ${short(plan.destinationAddress)}\n` +
      `Network fee: ${sol(plan.feeLamports)}${rent}\n` +
      'This public route is visible on Solana and does not use Umbra or charge an Umbra registration fee. The transfer is atomic: if it fails, the amount remains available.',
      [
        { text: 'Cancel', style: 'cancel', onPress: () => setPhase('idle') },
        { text: 'Confirm and sign', onPress: () => void submit(plan) },
      ],
      { cancelable: false },
    );
  };

  const submit = async (plan: DirectWithdrawalPlan) => {
    if (!config.ok || session.signer === null) return;
    setPhase('submitting');
    try {
      const result = await submitDirectWithdrawal({
        plan,
        rpcUrl: config.value.api.rpcUrl,
        signer: session.signer,
      });
      onBalancesChanged();
      if (result.status === 'confirmed') {
        setAmount('');
        setWithdrawMaximum(false);
        setPhase('idle');
        publishInAppNotification({
          kind: 'withdrawal', outcome: 'success', title: 'Direct withdrawal confirmed',
          message: `${formatTokenAmount(plan.amountBaseUnits, plan.decimals)} ${plan.symbol} reached ${short(plan.destinationAddress)}.`,
        });
      } else {
        setPhase('pending');
        publishInAppNotification({
          kind: 'withdrawal', outcome: 'info', title: 'Direct withdrawal submitted',
          message: 'Solana confirmation is pending. Balances remain chain-backed and will refresh after settlement.',
        });
      }
    } catch (cause) {
      setPhase('idle');
      onBalancesChanged();
      publishInAppNotification({
        kind: 'withdrawal', outcome: 'error', title: 'Direct withdrawal failed',
        message: directErrorMessage(cause),
      });
    }
  };

  return (
    <View style={styles.panel}>
      <Text accessibilityRole="header" style={styles.title}>Direct withdrawal</Text>
      <Text style={styles.note}>
        Sends directly from your private balance. Return provider funds first. Failed transfers keep the amount available; Solana may still charge a network fee.
      </Text>
      <View style={styles.buttons}>
        <ActionButton
          label="Public wallet"
          onPress={() => setDestinationMode('privy')}
          selected={destinationMode === 'privy'}
          style={styles.button}
          tone={destinationMode === 'privy' ? 'accent' : 'neutral'}
        />
        <ActionButton
          label="Other wallet"
          onPress={() => setDestinationMode('external')}
          selected={destinationMode === 'external'}
          style={styles.button}
          tone={destinationMode === 'external' ? 'accent' : 'neutral'}
        />
      </View>
      <View style={styles.amountRow}>
        <TextInput
          accessibilityLabel={`${asset?.symbol ?? 'Token'} withdrawal amount`}
          editable={!running}
          inputMode="decimal"
          onChangeText={(value) => {
            setAmount(value);
            setWithdrawMaximum(false);
          }}
          placeholder="0.00"
          placeholderTextColor={colors.textMuted}
          style={[styles.input, styles.amountInput]}
          value={amount}
        />
        <TokenSelector
          disabled={running || tokens.length === 0}
          onSelect={(id) => {
            setChosenId(id);
            setAmount('');
            setWithdrawMaximum(false);
          }}
          selectedMint={selected?.id ?? ''}
          symbol={asset?.symbol ?? 'Token'}
          tokens={tokens}
        />
        <ActionButton
          disabled={running || asset === null || (
            destinationMode === 'privy' && mainWalletAddress === null
          )}
          label="Max"
          loading={phase === 'quoting'}
          onPress={() => void prepare(true, true)}
          style={styles.max}
          tone="neutral"
        />
      </View>
      {destinationMode === 'external' ? (
        <TextInput
          accessibilityLabel="Destination Solana wallet"
          autoCapitalize="none"
          editable={!running}
          onChangeText={setExternalAddress}
          placeholder="Solana wallet address"
          placeholderTextColor={colors.textMuted}
          style={styles.input}
          value={externalAddress}
        />
      ) : null}
      <ActionButton
        disabled={running || asset === null || (
          destinationMode === 'privy' && mainWalletAddress === null
        )}
        label={phase === 'pending'
          ? 'Withdrawal confirming'
          : phase === 'quoting'
            ? 'Calculating max'
          : phase === 'preparing'
            ? 'Checking fees'
            : phase === 'submitting'
              ? 'Submitting withdrawal'
              : 'Review direct withdrawal'}
        loading={phase === 'preparing' || phase === 'submitting'}
        onPress={() => void prepare()}
      />
    </View>
  );
}

function directTokens(balances: WalletBalances | null): readonly WithdrawableToken[] {
  if (balances === null) return [];
  const config = readAppConfig();
  const known = new Map((config.ok
    ? listTradingCollateralOptions(config.value.perps.usdcMint, config.value.perps.usdtMint)
    : []).map((asset) => [asset.mint, asset]));
  const nativeMint = NATIVE_MINT.toBase58();
  const tokens = balances.privateWallet.holdings.flatMap((holding): WithdrawableToken[] => {
    if (holding.baseUnits <= 0n) return [];
    const configured = known.get(holding.mint);
    const asset: PrivateExitAsset = configured === undefined
      ? {
          decimals: holding.decimals,
          kind: 'spl',
          mint: holding.mint,
          symbol: holding.mint === nativeMint
            ? 'WSOL'
            : `MINT-${holding.mint.slice(0, 5).toUpperCase()}`,
        }
      : { ...configured, kind: 'spl' };
    return [{ asset, baseUnits: holding.baseUnits, id: `spl:${holding.mint}` }];
  });
  if (balances.privateWallet.solLamports > 0n) {
    tokens.unshift({
      asset: { decimals: 9, kind: 'native', mint: nativeMint, symbol: 'SOL' },
      baseUnits: balances.privateWallet.solLamports,
      id: `native:${nativeMint}`,
    });
  }
  return tokens;
}

function directErrorMessage(cause: unknown): string {
  if (cause instanceof DirectWithdrawalError) return cause.message;
  if (cause instanceof TransactionSigningError) {
    if (cause.code === 'transaction_failed') {
      return 'The transfer failed on-chain. The amount remains available; Solana may still charge a network fee.';
    }
    if (cause.code === 'submission_rejected') {
      return 'Solana rejected the transfer before submission. The amount remains available.';
    }
    if (cause.code === 'blockhash_expired') return 'The withdrawal preview expired. Review it again.';
    if (cause.code.includes('signature')) return 'The withdrawal was not approved. No funds were moved.';
  }
  return 'The direct withdrawal did not complete. Wallet balances were refreshed from Solana.';
}

function sol(lamports: bigint): string {
  return `${formatTokenAmount(lamports, 9)} SOL`;
}

function maxCostMessage(plan: DirectWithdrawalPlan): string {
  const rent = plan.rentLamports > 0n
    ? ` Recipient token-account rent: ${sol(plan.rentLamports)}.`
    : '';
  return `Max: ${formatTokenAmount(plan.amountBaseUnits, plan.decimals)} ${plan.symbol}. ` +
    `Network fee: ${sol(plan.feeLamports)}.${rent} Costs are checked again before signing.`;
}

function short(address: string): string {
  return `${address.slice(0, 5)}…${address.slice(-5)}`;
}

const styles = StyleSheet.create({
  panel: { gap: spacing.md },
  title: { ...typography.heading, color: colors.textPrimary },
  note: { ...typography.bodyCompact, color: colors.textSecondary },
  buttons: { flexDirection: 'row', gap: spacing.sm },
  button: { flex: 1 },
  amountRow: { flexDirection: 'row', alignItems: 'stretch', gap: spacing.xs },
  input: {
    minHeight: layout.minTouchTarget,
    paddingHorizontal: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
    borderRadius: radii.sm,
    color: colors.textPrimary,
    backgroundColor: colors.background,
    ...typography.bodyCompact,
  },
  amountInput: { flex: 1, minWidth: 0 },
  max: { minWidth: 64 },
});
