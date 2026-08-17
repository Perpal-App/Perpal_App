import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import { ActionButton } from '@/components/ui/ActionButton';
import { Button } from '@/components/ui/Button';
import { StatusRow } from '@/components/ui/StatusRow';
import {
  amountFromBaseUnits,
  formatAmount,
  formatAmountWithCommas,
  parseAmount,
} from '@/domain/money/amount';
import { TradeCollateralStepView } from '@/features/trade/components/TradeCollateralStepView';
import { useTradeActionRecovery } from '@/features/trade/hooks/useTradeActionRecovery';
import type { PacificaMarket, PacificaMarketSnapshot } from '@/integrations/perps/pacifica/pacificaMarketData';
import {
  preparePacificaMarketOrder,
  submitPacificaMarketOrder,
  type PacificaMarginMode,
  type PacificaMarketOrderPlan,
  type PacificaOrderAction,
  type PacificaOrderSide,
} from '@/integrations/perps/pacifica/pacificaOrder';
import {
  fetchPacificaPortfolio,
  type PacificaPortfolioSnapshot,
} from '@/integrations/perps/pacifica/pacificaPortfolio';
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
  const [marginMode, setMarginMode] = useState<PacificaMarginMode>(props.market.isolatedOnly ? 'isolated' : 'cross');
  const [collateral, setCollateral] = useState('');
  const [leverage, setLeverage] = useState(String(Math.min(5, props.market.maxLeverage)));
  const [percentage, setPercentage] = useState(0);
  const [tpSlEnabled, setTpSlEnabled] = useState(false);
  const [takeProfit, setTakeProfit] = useState('');
  const [stopLoss, setStopLoss] = useState('');
  const [portfolio, setPortfolio] = useState<PacificaPortfolioSnapshot | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [plan, setPlan] = useState<PacificaMarketOrderPlan | null>(null);
  const [preparation, setPreparation] = useState<TradeCollateralStep | null>(null);
  const [orderId, setOrderId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [railWidth, setRailWidth] = useState(0);
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
    setPercentage(0);
    setTpSlEnabled(false);
    setTakeProfit('');
    setStopLoss('');
    setMarginMode(props.market.isolatedOnly ? 'isolated' : 'cross');
    setLeverage(String(Math.min(5, props.market.maxLeverage)));
    if (session.status !== 'ready' || session.address === null) return;
    const abort = new AbortController();
    controller.current = abort;
    void fetchPacificaPortfolio(props.apiOrigin, session.address, abort.signal)
      .then((next) => { if (!abort.signal.aborted) setPortfolio(next); })
      .catch((cause) => {
        if (!abort.signal.aborted) {
          logTradeError('pacifica', 'preparation', cause);
          setError(cause instanceof Error ? cause.message : 'Trading balance is unavailable.');
        }
      });
    return () => abort.abort();
  }, [props.apiOrigin, props.market.venueRef, session.address, session.status]);

  const setCollateralPercentage = (next: number) => {
    if (portfolio === null) return;
    const percent = Math.max(0, Math.min(100, Math.round(next)));
    const available = parseAmount(portfolio.availableToSpend, 6).baseUnits;
    setCollateral(formatAmount(amountFromBaseUnits((available * BigInt(percent)) / 100n, 6)));
    setPercentage(percent);
    reset();
  };

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
      const latestPortfolio = await fetchPacificaPortfolio(props.apiOrigin, session.address, abort.signal);
      setPortfolio(latestPortfolio);
      const nextPlan = await preparePacificaMarketOrder({
        action,
        collateralBaseUnits,
        leverage: action === 'open' ? Number(leverage) : 1,
        marginMode,
        market: props.market,
        portfolio: latestPortfolio,
        side,
        snapshot: props.snapshot,
        ...(tpSlEnabled ? { stopLossPrice: stopLoss, takeProfitPrice: takeProfit } : {}),
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
      setError('Collateral confirmed. Review after Pacifica updates the trading balance.');
      publishInAppNotification({
        kind: 'funding', outcome: 'success', title: 'Trading collateral confirmed',
        message: 'Pacifica is updating the available trading balance.',
      });
    } catch (cause) {
      if (!abort.signal.aborted) {
        logTradeError('pacifica', 'submission', cause);
        setError(cause instanceof Error ? cause.message : 'Trade preparation failed.');
        setPhase('idle');
        publishInAppNotification({
          kind: 'funding', outcome: 'error', title: 'Trading collateral not confirmed',
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
        kind: 'trade', outcome: 'success',
        title: `${confirmed.action === 'open' ? 'Open' : 'Close'} order accepted`,
        message: `${props.market.baseAsset} ${confirmed.side} order was accepted by Pacifica.`,
      });
    } catch (cause) {
      logTradeError('pacifica', 'submission', cause);
      setError(cause instanceof Error ? cause.message : 'Pacifica order failed.');
      setPlan(null);
      setPhase('idle');
      publishInAppNotification({
        kind: 'trade', outcome: 'error', title: 'Order not submitted',
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

  const position = portfolio?.positions.find(
    (candidate) => candidate.symbol === props.market.venueRef && candidate.side === side,
  );
  const confirm = () => plan && Alert.alert(
    `${plan.action === 'open' ? 'Open' : 'Close'} ${plan.side} ${props.market.baseAsset}?`,
    [
      `Size ${plan.amount} ${props.market.baseAsset}`,
      `Mark $${priceText(plan.markPrice)}`,
      `Notional ${usdc(plan.notionalBaseUnits)}`,
      `Estimated fee ${usdc(plan.estimatedFeeBaseUnits)}`,
      `Leverage ${plan.leverage}× · ${plan.marginMode}`,
      `Slippage limit ${plan.slippagePercent}%`,
      plan.takeProfit === null ? null : `Take profit $${priceText(plan.takeProfit.stopPrice)}`,
      plan.stopLoss === null ? null : `Stop loss $${priceText(plan.stopLoss.stopPrice)}`,
    ].filter(Boolean).join('\n'),
    [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Confirm and sign', onPress: () => void submit(plan) },
    ],
  );
  const reduceOnly = action === 'close';

  return (
    <View style={styles.panel}>
      <Text accessibilityRole="header" style={styles.title}>Order</Text>
      <View style={styles.controls}>
        <Choice disabled={props.market.isolatedOnly} label="Cross" onPress={() => { reset(); setMarginMode('cross'); }} selected={marginMode === 'cross'} />
        <Choice label="Isolated" onPress={() => { reset(); setMarginMode('isolated'); }} selected={marginMode === 'isolated'} />
      </View>
      <View style={styles.controls}>
        <StaticControl label="Market" />
        <Field accessibilityLabel="Leverage" onChangeText={(value) => { reset(); setLeverage(value); }} suffix="×" value={leverage} />
      </View>
      <View style={styles.controls}>
        <Choice label={reduceOnly ? 'Close long' : `Buy ${props.market.baseAsset}`} onPress={() => { reset(); setSide('long'); }} selected={side === 'long'} tone="long" />
        <Choice label={reduceOnly ? 'Close short' : `Sell ${props.market.baseAsset}`} onPress={() => { reset(); setSide('short'); }} selected={side === 'short'} tone="short" />
      </View>
      <View style={styles.readonlyField}>
        <Text selectable style={styles.priceValue}>${formatAmountWithCommas(props.snapshot.price)}</Text>
        <Text style={styles.suffix}>USD</Text>
      </View>
      {reduceOnly ? null : (
        <>
          <Field accessibilityLabel="USDC collateral" onChangeText={(value) => { reset(); setPercentage(0); setCollateral(value); }} placeholder="Collateral" suffix="USDC" value={collateral} />
          <View style={styles.sliderRow}>
            <Pressable
              accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
              accessibilityLabel="Collateral percentage"
              accessibilityRole="adjustable"
              accessibilityValue={{ min: 0, max: 100, now: percentage, text: `${percentage}%` }}
              onAccessibilityAction={(event) => setCollateralPercentage(percentage + (event.nativeEvent.actionName === 'increment' ? 25 : -25))}
              onLayout={(event) => setRailWidth(event.nativeEvent.layout.width)}
              onPress={(event) => { if (railWidth > 0) setCollateralPercentage((event.nativeEvent.locationX / railWidth) * 100); }}
              style={styles.rail}
            >
              <View style={[styles.railFill, { width: `${percentage}%` }]} />
              <View style={[styles.thumb, { left: `${percentage}%` }]} />
            </Pressable>
            <View style={styles.percentValue}><Text style={styles.percentLabel}>{percentage}%</Text></View>
          </View>
          <View style={styles.presets}>
            {[25, 50, 75, 100].map((value) => (
              <Pressable accessibilityRole="button" key={value} onPress={() => setCollateralPercentage(value)} style={[styles.preset, value === percentage && styles.presetSelected]}>
                <Text style={styles.presetLabel}>{value}%</Text>
              </Pressable>
            ))}
          </View>
        </>
      )}
      <Toggle label="Reduce only" onChange={(value) => { reset(); setAction(value ? 'close' : 'open'); if (value) setTpSlEnabled(false); }} value={reduceOnly} />
      <Toggle disabled={reduceOnly} label="TP / SL" onChange={(value) => { reset(); setTpSlEnabled(value); }} value={tpSlEnabled} />
      {tpSlEnabled && !reduceOnly ? (
        <View style={styles.controls}>
          <Field accessibilityLabel="Take-profit price" onChangeText={(value) => { reset(); setTakeProfit(value); }} placeholder="Take profit" suffix="USD" value={takeProfit} />
          <Field accessibilityLabel="Stop-loss price" onChangeText={(value) => { reset(); setStopLoss(value); }} placeholder="Stop loss" suffix="USD" value={stopLoss} />
        </View>
      ) : null}
      {preparation !== null ? (
        <TradeCollateralStepView loading={phase === 'submitting'} onConfirm={() => void submitPreparation()} step={preparation} />
      ) : plan !== null ? (
        <View style={styles.summary}>
          <StatusRow label="Size" value={`${plan.amount} ${props.market.baseAsset}`} />
          <StatusRow label="Notional" value={usdc(plan.notionalBaseUnits)} />
          <StatusRow label="Estimated fee" value={usdc(plan.estimatedFeeBaseUnits)} />
          <ActionButton label="Review and confirm" loading={phase === 'submitting'} onPress={confirm} tone={side === 'long' ? 'positive' : 'negative'} />
        </View>
      ) : phase === 'complete' ? (
        <Text accessibilityLiveRegion="polite" style={styles.success}>Pacifica accepted order {orderId}.</Text>
      ) : (
        <ActionButton label={`Review ${reduceOnly ? 'close' : side}`} loading={phase === 'preparing'} onPress={() => void prepare()} tone={side === 'long' ? 'positive' : 'negative'} />
      )}
      <View style={styles.riskRows}>
        <StatusRow label="Max slippage" value="0.5%" />
        <StatusRow label="Liquidation price" value={position?.liquidationPrice ? `$${priceText(position.liquidationPrice)}` : '--'} />
        <StatusRow label="Margin" value={reduceOnly ? decimalUsd(position?.margin) : decimalUsd(collateral)} />
        <StatusRow label="Available" value={decimalUsd(portfolio?.availableToSpend)} />
      </View>
      {error !== null ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    </View>
  );
}

function Choice(props: { readonly disabled?: boolean; readonly label: string; readonly onPress: () => void; readonly selected: boolean; readonly tone?: 'long' | 'short' }) {
  return (
    <Pressable accessibilityRole="radio" accessibilityState={{ checked: props.selected, disabled: props.disabled }} disabled={props.disabled} onPress={props.onPress} style={[styles.choice, props.selected && styles.choiceSelected, props.tone === 'long' && props.selected && styles.longSelected, props.tone === 'short' && props.selected && styles.shortSelected, props.disabled && styles.disabled]}>
      <Text numberOfLines={1} style={[styles.choiceLabel, props.tone === 'long' && props.selected && styles.longLabel, props.tone === 'short' && props.selected && styles.shortLabel]}>{props.label}</Text>
    </Pressable>
  );
}

function Field(props: { readonly accessibilityLabel: string; readonly onChangeText: (value: string) => void; readonly placeholder?: string; readonly suffix: string; readonly value: string }) {
  return (
    <View style={styles.field}>
      <TextInput accessibilityLabel={props.accessibilityLabel} inputMode="decimal" onChangeText={props.onChangeText} placeholder={props.placeholder} placeholderTextColor={colors.textMuted} style={styles.input} value={props.value} />
      <Text style={styles.suffix}>{props.suffix}</Text>
    </View>
  );
}

function StaticControl({ label }: { readonly label: string }) {
  return <View style={styles.staticControl}><Text style={styles.choiceLabel}>{label}</Text></View>;
}

function Toggle(props: { readonly disabled?: boolean; readonly label: string; readonly onChange: (value: boolean) => void; readonly value: boolean }) {
  return (
    <View style={[styles.toggleRow, props.disabled && styles.disabled]}>
      <Switch accessibilityLabel={props.label} disabled={props.disabled} onValueChange={props.onChange} thumbColor={props.value ? colors.accentSoft : colors.textMuted} trackColor={{ false: colors.borderStrong, true: colors.accent }} value={props.value} />
      <Text style={styles.toggleLabel}>{props.label}</Text>
    </View>
  );
}

function usdc(value: bigint): string {
  return `${formatAmountWithCommas(amountFromBaseUnits(value, 6))} USDC`;
}

function decimalUsd(value: string | undefined): string {
  if (value === undefined || value.trim().length === 0) return '--';
  try { return `$${formatAmountWithCommas(parseAmount(value, 6))}`; } catch { return '--'; }
}

function priceText(value: string): string {
  try { return formatAmountWithCommas(parseAmount(value, 10)); } catch { return value; }
}

const styles = StyleSheet.create({
  panel: { gap: spacing.sm, paddingVertical: spacing.sm },
  title: { ...typography.heading, color: colors.textPrimary },
  message: { ...typography.bodyCompact, color: colors.textSecondary },
  controls: { flexDirection: 'row', gap: spacing.sm },
  choice: { flex: 1, minWidth: 0, minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xs, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radii.sm, backgroundColor: colors.surface },
  choiceSelected: { borderColor: colors.accent, backgroundColor: colors.surfaceElevated },
  longSelected: { borderColor: colors.positive },
  shortSelected: { borderColor: colors.negative },
  choiceLabel: { ...typography.bodyCompact, color: colors.textPrimary },
  longLabel: { color: colors.positive },
  shortLabel: { color: colors.negative },
  staticControl: { flex: 1, minHeight: 50, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radii.sm, backgroundColor: colors.surface },
  readonlyField: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.md, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radii.sm, backgroundColor: colors.surface },
  priceValue: { ...typography.heading, color: colors.textPrimary },
  field: { flex: 1, minWidth: 0, minHeight: 50, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radii.sm, backgroundColor: colors.surface },
  input: { flex: 1, minWidth: 0, minHeight: 48, paddingHorizontal: spacing.md, color: colors.textPrimary, ...typography.bodyCompact },
  suffix: { ...typography.caption, paddingRight: spacing.md, color: colors.textMuted },
  sliderRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  rail: { flex: 1, height: 24, justifyContent: 'center' },
  railFill: { height: 3, borderRadius: radii.pill, backgroundColor: colors.accent },
  thumb: { position: 'absolute', width: 18, height: 18, marginLeft: -9, borderRadius: radii.pill, borderWidth: 2, borderColor: colors.accentSoft, backgroundColor: colors.surfaceElevated },
  percentValue: { width: 58, minHeight: 42, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radii.sm },
  percentLabel: { ...typography.bodyCompact, color: colors.textPrimary },
  presets: { flexDirection: 'row', gap: spacing.xs },
  preset: { flex: 1, minHeight: 40, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radii.sm },
  presetSelected: { borderColor: colors.accent, backgroundColor: colors.surfaceElevated },
  presetLabel: { ...typography.caption, color: colors.textPrimary },
  toggleRow: { minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  toggleLabel: { ...typography.bodyCompact, color: colors.textSecondary },
  summary: { gap: spacing.sm, paddingTop: spacing.xs },
  riskRows: { gap: spacing.xs, paddingTop: spacing.xs, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  success: { ...typography.bodyCompact, color: colors.positive },
  error: { ...typography.bodyCompact, color: colors.negative },
  disabled: { opacity: 0.45 },
});
