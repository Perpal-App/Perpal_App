import { useEmbeddedSolanaWallet } from '@privy-io/expo';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Text, TextInput, View } from 'react-native';
import { PublicKey } from '@solana/web3.js';

import { ActionButton } from '@/components/ui/ActionButton';
import { readAppConfig } from '@/config/appConfig';
import { directWithdrawPanelStyles as styles } from '@/features/portfolio/components/directWithdrawPanelStyles';
import type { WalletBalances } from '@/features/account/hooks/useWalletBalances';
import { WithdrawalTokenSelector } from '@/features/portfolio/components/WithdrawalTokenSelector';
import {
  formatTokenAmount,
  parseTokenAmount,
} from '@/features/portfolio/components/withdrawalAssets';
import {
  directErrorMessage,
  directWithdrawalTokens,
  maxCostMessage,
  pacificaReleaseRequirement,
  publicTransactionAuthority,
  shortAddress,
  sol,
  walletAssetBalance,
  type DirectWithdrawalSource,
  type PacificaReleaseRequirement,
} from '@/features/portfolio/components/directWithdrawPanelSupport';
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
import { colors } from '@/theme/tokens';
import { useTradingSession } from '@/wallet/trading/TradingSessionProvider';

export function DirectWithdrawPanel({
  balances,
  mainWalletAddress,
  onBalancesChanged,
  onPacificaRefresh,
  snapshot = null,
  source = 'private',
}: {
  readonly balances: WalletBalances | null;
  readonly mainWalletAddress: string | null;
  readonly onBalancesChanged: () => void | Promise<void>;
  readonly onPacificaRefresh?: () => void | Promise<void>;
  readonly snapshot?: PacificaPortfolioSnapshot | null;
  readonly source?: DirectWithdrawalSource;
}) {
  const config = readAppConfig();
  const embeddedWallet = useEmbeddedSolanaWallet();
  const session = useTradingSession();
  const [amount, setAmount] = useState('');
  const [chosenId, setChosenId] = useState('');
  const [destinationMode, setDestinationMode] = useState<'privy' | 'external'>(
    source === 'public' ? 'external' : 'privy',
  );
  const [externalAddress, setExternalAddress] = useState('');
  const [phase, setPhase] = useState<DirectWithdrawalPhase>('idle');
  const [withdrawMaximum, setWithdrawMaximum] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const tokens = useMemo(
    () => directWithdrawalTokens(balances, source, snapshot),
    [balances, snapshot, source],
  );
  const selected = tokens.find((token) => token.id === chosenId) ?? tokens[0] ?? null;
  const asset = selected?.asset ?? null;
  const availableBaseUnits = selected?.baseUnits ?? null;
  const running = phase !== 'idle';
  const owner = source === 'public' ? mainWalletAddress : session.address;

  useEffect(() => () => controller.current?.abort(), []);

  useDirectWithdrawalRecovery({
    onBalancesChanged,
    owner,
    rpcUrl: config.ok ? config.value.api.rpcUrl : null,
    setPhase,
    signer: session.signer,
  });

  const buildSolanaReview = async (input: {
    readonly amountBaseUnits: bigint | 'max';
    readonly destinationAddress: string;
    readonly quoteOnly: boolean;
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
    if (input.quoteOnly) {
      setAmount(formatTokenAmount(plan.amountBaseUnits, plan.decimals));
      setWithdrawMaximum(true);
      setPhase('idle');
      showAppToast({ outcome: 'info', title: 'Maximum calculated', message: maxCostMessage(plan) });
      return;
    }
    review(plan);
  };

  const releasePacificaAndContinue = async (input: {
    readonly amountBaseUnits: bigint | 'max';
    readonly destinationAddress: string;
    readonly quoteOnly: boolean;
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
      if (input.release.kind === 'resume') {
        await resumePacificaCollateralWithdrawalToWallet(withdrawalInput);
      } else {
        await ensurePacificaCollateralInWallet(
          input.release.targetWalletBalanceBaseUnits,
          withdrawalInput,
        );
      }
      if (input.signal.aborted) return;
      await Promise.all([
        onBalancesChanged(),
        onPacificaRefresh?.(),
      ]);
      await buildSolanaReview(input);
    } catch (cause) {
      if (!input.signal.aborted) {
        setPhase('idle');
        onBalancesChanged();
        onPacificaRefresh?.();
        showAppToast({
          outcome: 'error',
          title: 'Withdrawal unavailable',
          message: directErrorMessage(cause),
        });
      }
    }
  };

  const prepare = async (
    quoteOnly = false,
    maximum = withdrawMaximum,
  ) => {
    if (
      !config.ok ||
      session.status !== 'ready' ||
      owner === null ||
      session.signer === null ||
      selected === null ||
      asset === null ||
      availableBaseUnits === null
    ) {
      showAppToast({
        outcome: 'error', title: 'Withdrawal unavailable',
        message: `${source === 'public' ? 'Public wallet' : 'Private'} balances are still loading.`,
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

    const privateUsdc = source === 'private' && asset.kind === 'spl' &&
      asset.mint === config.value.perps.usdcMint;
    if (quoteOnly && privateUsdc) {
      setAmount(formatTokenAmount(availableBaseUnits, asset.decimals));
      setWithdrawMaximum(false);
      setPhase('idle');
      showAppToast({
        outcome: 'info',
        title: 'Maximum selected',
        message: `${formatTokenAmount(availableBaseUnits, asset.decimals)} USDC includes withdrawable Pacifica funds. Fees are reviewed before either step.`,
      });
      return;
    }

    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setPhase(quoteOnly ? 'quoting' : 'preparing');
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

      if (privateUsdc && session.address !== null) {
        const pendingProviderAmount = await pendingPacificaWithdrawalBaseUnits(session.address);
        const targetWalletBalanceBaseUnits = amountBaseUnits === 'max'
          ? availableBaseUnits
          : amountBaseUnits;
        const release = pacificaReleaseRequirement({
          feeBaseUnits: config.value.perps.pacificaWithdrawalFeeBaseUnits,
          pendingBaseUnits: pendingProviderAmount,
          targetWalletBalanceBaseUnits,
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
              quoteOnly,
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
        quoteOnly,
        signal: abort.signal,
      });
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
      `Destination: ${shortAddress(plan.destinationAddress)}\n` +
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
      onBalancesChanged();
      if (result.status === 'confirmed') {
        setAmount('');
        setWithdrawMaximum(false);
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
          message: 'Solana confirmation is pending. Balances remain chain-backed and will refresh after settlement.',
        });
      }
    } catch (cause) {
      setPhase('idle');
      onBalancesChanged();
      publishInAppNotification({
        kind: 'withdrawal', outcome: 'error', title: 'Direct withdrawal failed',
        scopeToken: notificationScope,
        message: directErrorMessage(cause),
      });
    }
  };

  return (
    <View style={styles.panel}>
      <Text accessibilityRole="header" style={styles.title}>
        {source === 'public' ? 'Send' : 'Direct withdrawal'}
      </Text>
      <Text style={styles.note}>
        {source === 'public'
          ? 'Send supported tokens. Fees and account rent are shown before approval.'
          : 'Pacifica USDC is released automatically when needed.'}
      </Text>
      {source === 'private' ? <View style={styles.buttons}>
        <ActionButton
          disabled={running}
          label="Public wallet"
          onPress={() => setDestinationMode('privy')}
          selected={destinationMode === 'privy'}
          style={styles.button}
          tone={destinationMode === 'privy' ? 'accent' : 'neutral'}
        />
        <ActionButton
          disabled={running}
          label="Other wallet"
          onPress={() => setDestinationMode('external')}
          selected={destinationMode === 'external'}
          style={styles.button}
          tone={destinationMode === 'external' ? 'accent' : 'neutral'}
        />
      </View> : null}
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
        <WithdrawalTokenSelector
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
      {source === 'public' || destinationMode === 'external' ? (
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
              : source === 'public' ? 'Review send' : 'Review direct withdrawal'}
        loading={phase === 'preparing' || phase === 'submitting'}
        onPress={() => void prepare()}
      />
    </View>
  );
}
