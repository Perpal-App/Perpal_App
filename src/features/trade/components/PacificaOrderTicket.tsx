import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { StatusRow } from '@/components/ui/StatusRow';
import { amountFromBaseUnits, formatAmount, parseAmount } from '@/domain/money/amount';
import { TradeCollateralStepView } from '@/features/trade/components/TradeCollateralStepView';
import { useTradeActionRecovery } from '@/features/trade/hooks/useTradeActionRecovery';
import type {
  PacificaMarket,
  PacificaMarketSnapshot,
} from '@/integrations/perps/pacifica/pacificaMarketData';
import {
  preparePacificaMarketOrder,
  submitPacificaMarketOrder,
  type PacificaMarketOrderPlan,
  type PacificaOrderAction,
  type PacificaOrderSide,
} from '@/integrations/perps/pacifica/pacificaOrder';
import { fetchPacificaPortfolio } from '@/integrations/perps/pacifica/pacificaPortfolio';
import {
  preparePacificaTradeCollateral,
  submitTradeCollateralStep,
  type TradeCollateralStep,
} from '@/integrations/perps/tradeCollateral';
import { logTradeError } from '@/integrations/observability/tradeError';
import { publishInAppNotification } from '@/storage/inAppNotifications';
import { colors, radii, spacing, typography } from '@/theme/tokens';
import { useTradingSession } from '@/wallet/trading/TradingSessionProvider';

type Phase = 'idle' | 'preparing' | 'prepared' | 'submitting' | 'complete';

export function PacificaOrderTicket(props: {
  readonly apiOrigin: string;
  readonly centralState: string;
  readonly initialSide?: PacificaOrderSide;
  readonly market: PacificaMarket;
  readonly programId: string;
  readonly rpcUrl: string;
  readonly snapshot: PacificaMarketSnapshot;
  readonly swapBuildUrl: string;
  readonly usdcMint: string;
  readonly usdtMint: string;
  readonly vault: string;
}) {
  const router = useRouter();
  const session = useTradingSession();
  const [action, setAction] = useState<PacificaOrderAction>('open');
  const [side, setSide] = useState<PacificaOrderSide>(props.initialSide ?? 'long');
  const [collateral, setCollateral] = useState('');
  const [leverage, setLeverage] = useState('5');
  const [phase, setPhase] = useState<Phase>('idle');
  const [plan, setPlan] = useState<PacificaMarketOrderPlan | null>(null);
  const [preparation, setPreparation] = useState<TradeCollateralStep | null>(null);
  const [orderId, setOrderId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const recovery = useTradeActionRecovery({
    owner: session.address,
    provider: 'pacifica',
    rpcUrl: props.rpcUrl,
    signer: session.signer,
  });

  const reset = () => {
    controller.current?.abort();
    setPlan(null);
    setPreparation(null);
    setOrderId(null);
    setError(null);
    setPhase('idle');
  };
  useEffect(() => {
    reset();
    setCollateral('');
    return () => controller.current?.abort();
  }, [props.market.venueRef, session.address]);

  const prepare = async () => {
    if (session.address === null || session.signer === null) {
      setError('Activate private trading before preparing an order.');
      return;
    }
    const abort = new AbortController();
    controller.current?.abort();
    controller.current = abort;
    setPhase('preparing');
    setPlan(null);
    setPreparation(null);
    setError(null);
    try {
      if (await recovery.reconcile(abort.signal) === 'pending') {
        throw new Error('A previous collateral transaction is still confirming.');
      }
      const collateralBaseUnits = action === 'open' ? parseAmount(collateral, 6).baseUnits : 0n;
      if (action === 'open') {
        const next = await preparePacificaTradeCollateral({
          apiOrigin: props.apiOrigin,
          centralState: props.centralState,
          owner: session.address,
          programId: props.programId,
          requiredBaseUnits: collateralBaseUnits,
          rpcUrl: props.rpcUrl,
          signal: abort.signal,
          signer: session.signer,
          swapBuildUrl: props.swapBuildUrl,
          usdcMint: props.usdcMint,
          usdtMint: props.usdtMint,
          vault: props.vault,
        });
        if (next !== null) {
          setPreparation(next);
          setPhase('prepared');
          return;
        }
      }
      const portfolio = await fetchPacificaPortfolio(props.apiOrigin, session.address, abort.signal);
      const nextPlan = await preparePacificaMarketOrder({
        action,
        collateralBaseUnits,
        leverage: action === 'open' ? Number(leverage) : 1,
        market: props.market,
        portfolio,
        side,
        snapshot: props.snapshot,
      });
      if (!abort.signal.aborted) {
        setPlan(nextPlan);
        setPhase('prepared');
      }
    } catch (cause) {
      if (!abort.signal.aborted) {
        logTradeError('pacifica', 'preparation', cause);
        setError(cause instanceof Error ? cause.message : 'Pacifica order preview failed.');
        setPhase('idle');
      }
    }
  };

  const submitPreparation = async () => {
    if (preparation === null || session.address === null || session.signer === null) return;
    const abort = new AbortController();
    controller.current = abort;
    setPhase('submitting');
    setError(null);
    try {
      const result = await submitTradeCollateralStep({
        owner: session.address,
        rpcUrl: props.rpcUrl,
        signal: abort.signal,
        signer: session.signer,
        step: preparation,
      });
      if (result.status !== 'confirmed') {
        recovery.setPending(true);
        throw new Error('Collateral was signed and is still confirming. Do not submit it again.');
      }
      recovery.setPending(false);
      setPreparation(null);
      setPhase('idle');
      setError('Collateral confirmed. Review the order after Pacifica updates the account balance.');
      publishInAppNotification({
        kind: 'funding',
        outcome: 'success',
        title: 'Trading collateral confirmed',
        message: 'Pacifica is updating the available trading balance.',
      });
    } catch (cause) {
      if (!abort.signal.aborted) {
        logTradeError('pacifica', 'submission', cause);
        setError(cause instanceof Error ? cause.message : 'Trade preparation failed.');
        setPhase('idle');
        publishInAppNotification({
          kind: 'funding',
          outcome: 'error',
          title: 'Trading collateral not confirmed',
          message: 'Open the order ticket to review the collateral step.',
        });
      }
    }
  };

  const submit = async (confirmed: PacificaMarketOrderPlan) => {
    if (session.address === null || session.signer === null) return;
    setPhase('submitting');
    setError(null);
    try {
      const result = await submitPacificaMarketOrder({
        account: session.address,
        apiOrigin: props.apiOrigin,
        intentStartedAtMs: performance.now(),
        plan: confirmed,
        signer: session.signer,
      });
      setOrderId(result.orderId);
      setPhase('complete');
      publishInAppNotification({
        kind: 'trade',
        outcome: 'success',
        title: `${confirmed.action === 'open' ? 'Open' : 'Close'} order accepted`,
        message: `${props.market.baseAsset} ${confirmed.side} order was accepted by Pacifica.`,
      });
    } catch (cause) {
      logTradeError('pacifica', 'submission', cause);
      setError(cause instanceof Error ? cause.message : 'Pacifica order failed.');
      setPlan(null);
      setPhase('idle');
      publishInAppNotification({
        kind: 'trade',
        outcome: 'error',
        title: 'Order not submitted',
        message: `${props.market.baseAsset} order needs review.`,
      });
    }
  };

  if (session.status !== 'ready' || session.address === null || session.signer === null) {
    return (
      <View style={styles.panel}>
        <Text accessibilityRole="header" style={styles.title}>Trade {props.market.baseAsset}</Text>
        <Text style={styles.message}>Set up and fund private trading from Wallet first.</Text>
        <Button label="Open Wallet" onPress={() => router.push('/(tabs)/account')} />
      </View>
    );
  }

  const confirm = () => plan && Alert.alert(
    `${plan.action === 'open' ? 'Open' : 'Close'} ${plan.side} ${props.market.baseAsset}?`,
    `Size ${plan.amount} ${props.market.baseAsset}\nMark $${plan.markPrice}\nNotional ${usdc(plan.notionalBaseUnits)}\nEstimated fee ${usdc(plan.estimatedFeeBaseUnits)}\nLeverage ${plan.leverage}×\nMargin ${plan.marginMode}\nSlippage limit ${plan.slippagePercent}%`,
    [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Confirm and sign', onPress: () => void submit(plan) },
    ],
  );

  return (
    <View style={styles.panel}>
      <Text accessibilityRole="header" style={styles.title}>Order</Text>
      <View style={styles.controls}>
        <Choice selected={action === 'open'} label="Open" onPress={() => { reset(); setAction('open'); }} />
        <Choice selected={action === 'close'} label="Close" onPress={() => { reset(); setAction('close'); }} />
      </View>
      <View style={styles.controls}>
        <Choice selected={side === 'long'} label="Long" onPress={() => { reset(); setSide('long'); }} />
        <Choice selected={side === 'short'} label="Short" onPress={() => { reset(); setSide('short'); }} />
      </View>
      {action === 'open' ? (
        <View style={styles.controls}>
          <TextInput
            accessibilityLabel="USDC collateral"
            inputMode="decimal"
            onChangeText={(value) => { reset(); setCollateral(value); }}
            placeholder="USDC collateral"
            placeholderTextColor={colors.textMuted}
            style={styles.input}
            value={collateral}
          />
          <TextInput
            accessibilityLabel="Leverage"
            inputMode="numeric"
            onChangeText={(value) => { reset(); setLeverage(value); }}
            placeholder="Leverage"
            placeholderTextColor={colors.textMuted}
            style={styles.input}
            value={leverage}
          />
        </View>
      ) : null}
      {preparation !== null ? (
        <TradeCollateralStepView loading={phase === 'submitting'} onConfirm={() => void submitPreparation()} step={preparation} />
      ) : plan !== null ? (
        <View style={styles.summary}>
          <StatusRow label="Size" value={`${plan.amount} ${props.market.baseAsset}`} />
          <StatusRow label="Mark" value={`$${plan.markPrice}`} />
          <StatusRow label="Notional" value={usdc(plan.notionalBaseUnits)} />
          <StatusRow label="Estimated fee" value={usdc(plan.estimatedFeeBaseUnits)} />
          <StatusRow label="Margin mode" value={plan.marginMode} />
          <Button label="Review and confirm" loading={phase === 'submitting'} onPress={confirm} />
        </View>
      ) : phase === 'complete' ? (
        <Text accessibilityLiveRegion="polite" style={styles.success}>Pacifica accepted order {orderId}.</Text>
      ) : (
        <Button label="Review order" loading={phase === 'preparing'} onPress={() => void prepare()} />
      )}
      {error !== null ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    </View>
  );
}

function Choice(props: { readonly label: string; readonly onPress: () => void; readonly selected: boolean }) {
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected: props.selected }} onPress={props.onPress} style={[styles.choice, props.selected && styles.choiceSelected]}>
      <Text style={[styles.choiceLabel, props.selected && styles.choiceLabelSelected]}>{props.label}</Text>
    </Pressable>
  );
}

function usdc(value: bigint): string {
  return `${formatAmount(amountFromBaseUnits(value, 6))} USDC`;
}

const styles = StyleSheet.create({
  panel: { gap: spacing.md, paddingVertical: spacing.md },
  title: { ...typography.heading, color: colors.textPrimary },
  message: { ...typography.bodyCompact, color: colors.textSecondary },
  controls: { flexDirection: 'row', gap: spacing.sm },
  choice: { flex: 1, minHeight: 46, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radii.sm },
  choiceSelected: { backgroundColor: colors.accent, borderColor: colors.accent },
  choiceLabel: { ...typography.bodyCompact, color: colors.textPrimary },
  choiceLabelSelected: { color: colors.onAccent },
  input: { flex: 1, minHeight: 50, paddingHorizontal: spacing.md, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radii.sm, color: colors.textPrimary, ...typography.bodyCompact },
  summary: { gap: spacing.sm },
  success: { ...typography.bodyCompact, color: colors.positive },
  error: { ...typography.bodyCompact, color: colors.negative },
});
