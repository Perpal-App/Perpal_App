import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';

import { ActionButton } from '@/components/ui/ActionButton';
import { Button } from '@/components/ui/Button';
import {
  AmountError,
  amountFromBaseUnits,
  formatAmount,
  formatAmountWithCommas,
  parseAmount,
} from '@/domain/money/amount';
import {
  Choice,
  CollateralSlider,
  Field,
  PercentPresets,
  TicketRow,
  Toggle,
} from '@/features/trade/components/OrderTicketControls';
import { TradeCollateralStepView } from '@/features/trade/components/TradeCollateralStepView';
import { PacificaOrderTypeFields } from '@/features/trade/components/PacificaOrderTypeFields';
import { useTradeActionRecovery } from '@/features/trade/hooks/useTradeActionRecovery';
import type { PacificaMarket, PacificaMarketSnapshot } from '@/integrations/perps/pacifica/pacificaMarketData';
import {
  preparePacificaOrder,
  submitPacificaOrder,
  validatePacificaOrderDraft,
  PacificaOrderValidationError,
  type PacificaMarginMode,
  type PacificaOrderPlan,
  type PacificaOrderAction,
  type PacificaOrderSide,
  type PacificaOrderType,
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
import { colors, spacing, typography } from '@/theme/tokens';
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
  const [orderType, setOrderType] = useState<PacificaOrderType>('market');
  const [marginMode, setMarginMode] = useState<PacificaMarginMode>(props.market.isolatedOnly ? 'isolated' : 'cross');
  const [collateral, setCollateral] = useState('');
  const [leverage, setLeverage] = useState(String(Math.min(5, props.market.maxLeverage)));
  const [limitPrice, setLimitPrice] = useState('');
  const [triggerPrice, setTriggerPrice] = useState('');
  // The two ways to size collateral are independent controls, so neither reads the other's
  // state. `presetPercent` is the button that was last tapped and nothing else; the slider
  // owns its handle and only hears about `sliderReset`, which returns it to rest when its
  // claim is void — a new market, or an amount typed in by hand.
  const [presetPercent, setPresetPercent] = useState<number | null>(null);
  const [sliderReset, setSliderReset] = useState(0);
  const [tpSlEnabled, setTpSlEnabled] = useState(false);
  const [takeProfit, setTakeProfit] = useState('');
  const [stopLoss, setStopLoss] = useState('');
  const [portfolio, setPortfolio] = useState<PacificaPortfolioSnapshot | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [plan, setPlan] = useState<PacificaOrderPlan | null>(null);
  const [preparation, setPreparation] = useState<TradeCollateralStep | null>(null);
  const [orderId, setOrderId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
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
    setValidationError(null);
    setPhase('idle');
  };

  useEffect(() => {
    reset();
    setCollateral('');
    setLimitPrice('');
    setPresetPercent(null);
    setSliderReset((value) => value + 1);
    setTpSlEnabled(false);
    setTakeProfit('');
    setStopLoss('');
    setTriggerPrice('');
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

  /** Collateral as a share of what the account can spend. Both sizing controls end here. */
  const applyPercentage = (next: number) => {
    if (portfolio === null) return;
    const percent = Math.max(0, Math.min(100, Math.round(next)));
    const available = parseAmount(portfolio.availableToSpend, 6).baseUnits;
    setCollateral(formatAmount(amountFromBaseUnits((available * BigInt(percent)) / 100n, 6)));
    reset();
  };

  const prepare = async () => {
    if (session.address === null || session.signer === null) {
      setError('Activate private trading before preparing an order.');
      return;
    }
    try {
      validatePacificaOrderDraft({
        action, collateral, leverage, market: props.market, orderPrice: limitPrice, orderType, side,
        snapshot: props.snapshot, stopLossPrice: stopLoss, takeProfitPrice: takeProfit,
        tpSlEnabled, triggerPrice,
      });
    } catch (cause) {
      setValidationError(cause instanceof Error ? cause.message : 'Review the order inputs.');
      return;
    }
    const abort = new AbortController();
    controller.current?.abort();
    controller.current = abort;
    setPhase('preparing');
    setPlan(null);
    setPreparation(null);
    setError(null);
    setValidationError(null);
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
      const nextPlan = await preparePacificaOrder({
        action,
        collateralBaseUnits,
        leverage: action === 'open' ? Number(leverage) : 1,
        marginMode,
        market: props.market,
        orderPrice: limitPrice,
        orderType,
        portfolio: latestPortfolio,
        side,
        snapshot: props.snapshot,
        ...(tpSlEnabled ? { stopLossPrice: stopLoss, takeProfitPrice: takeProfit } : {}),
        triggerPrice,
      });
      if (!abort.signal.aborted) {
        setPlan(nextPlan);
        setPhase('prepared');
      }
    } catch (cause) {
      if (!abort.signal.aborted) {
        if (cause instanceof AmountError || cause instanceof PacificaOrderValidationError) {
          setValidationError(cause.message);
        } else {
          logTradeError('pacifica', 'preparation', cause);
          setError(cause instanceof Error ? cause.message : 'Pacifica order preview failed.');
        }
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

  const submit = async (confirmed: PacificaOrderPlan) => {
    if (session.address === null || session.signer === null) return;
    setPhase('submitting');
    setError(null);
    try {
      const result = await submitPacificaOrder({
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
      `Order type ${plan.orderType.replace('-', ' ')}`,
      `Size ${plan.amount} ${props.market.baseAsset}`,
      `Mark $${priceText(plan.markPrice)}`,
      plan.triggerPrice === null ? null : `Trigger $${priceText(plan.triggerPrice)}`,
      plan.orderPrice === null ? null : `Limit $${priceText(plan.orderPrice)}`,
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
  const stopOrder = orderType === 'stop-market' || orderType === 'stop-limit';

  return (
    // No "Order" heading: the workspace's Trade tab already names this column, and in a
    // half-width panel a title row costs a control's worth of height to repeat it.
    <View style={styles.panel}>
      <View style={styles.controls}>
        <Choice disabled={props.market.isolatedOnly} label="Cross" onPress={() => { reset(); setMarginMode('cross'); }} selected={marginMode === 'cross'} />
        <Choice label="Isolated" onPress={() => { reset(); setMarginMode('isolated'); }} selected={marginMode === 'isolated'} />
      </View>
      {/* Leverage rides on the order-type row rather than a row of its own. On its own it
          was a full-width box holding one digit and a multiplication sign, which read as
          an unfinished control and cost the column a row it did not need. */}
      <PacificaOrderTypeFields
        leverageField={
          <Field
            accessibilityLabel="Leverage"
            align="right"
            onChangeText={(value) => { reset(); setLeverage(value); }}
            suffix="×"
            value={leverage}
          />
        }
        limitPrice={limitPrice}
        markPrice={`$${formatAmountWithCommas(props.snapshot.price)}`}
        onLimitPriceChange={(value) => { reset(); setLimitPrice(value); }}
        onOrderTypeChange={(value) => {
          reset(); setOrderType(value); setLimitPrice(''); setTriggerPrice('');
          if (value === 'stop-market' || value === 'stop-limit') setTpSlEnabled(false);
        }}
        onTriggerPriceChange={(value) => { reset(); setTriggerPrice(value); }}
        orderType={orderType}
        triggerPrice={triggerPrice}
      />
      {/* One word each. `Buy BTC` and `Close short` both ran past a half-width button
          and truncated mid-ticker, and the ticker is already on the header above and in
          the confirmation before anything is signed. The full phrase is what a screen
          reader gets. */}
      <View style={styles.controls}>
        <Choice
          accessibilityLabel={reduceOnly
            ? `Close long ${props.market.baseAsset}`
            : `Buy ${props.market.baseAsset}`}
          label={reduceOnly ? 'Long' : 'Buy'}
          onPress={() => { reset(); setSide('long'); }}
          selected={side === 'long'}
          tone="long"
        />
        <Choice
          accessibilityLabel={reduceOnly
            ? `Close short ${props.market.baseAsset}`
            : `Sell ${props.market.baseAsset}`}
          label={reduceOnly ? 'Short' : 'Sell'}
          onPress={() => { reset(); setSide('short'); }}
          selected={side === 'short'}
          tone="short"
        />
      </View>
      {reduceOnly ? null : (
        <>
          {/* Typing is the authority over both sizing controls: once an exact amount is in
              the field, neither the handle's position nor a lit button describes it, so both
              stand down. */}
          <Field
            accessibilityLabel="USDC collateral"
            onChangeText={(value) => {
              reset();
              setPresetPercent(null);
              setSliderReset((current) => current + 1);
              setCollateral(value);
            }}
            placeholder="Collateral"
            suffix="USDC"
            value={collateral}
          />
          <CollateralSlider
            onChange={(next) => { applyPercentage(next); setPresetPercent(null); }}
            resetSignal={sliderReset}
          />
          {/* A button does not move the handle to its own value — that is the coupling this
              split exists to remove — but it does stand the handle down, because a rail
              parked at 30% beside a field holding 75% of the balance is a figure on screen
              that describes nothing. At rest the slider is simply not the control in play. */}
          <PercentPresets
            onSelect={(next) => {
              applyPercentage(next);
              setPresetPercent(next);
              setSliderReset((current) => current + 1);
            }}
            selected={presetPercent}
          />
        </>
      )}
      <Toggle label="Reduce only" onChange={(value) => { reset(); setAction(value ? 'close' : 'open'); if (value) setTpSlEnabled(false); }} value={reduceOnly} />
      <Toggle disabled={reduceOnly || stopOrder} label="TP / SL" onChange={(value) => { reset(); setTpSlEnabled(value); }} value={tpSlEnabled} />
      {/* Stacked, not side by side: `Take profit` and `Stop loss` are longer than a
          quarter-screen input can show, and a clipped placeholder on a price field is the
          one place in the ticket where a guess is expensive. */}
      {tpSlEnabled && !reduceOnly ? (
        <>
          <Field accessibilityLabel="Take-profit price" onChangeText={(value) => { reset(); setTakeProfit(value); }} placeholder="Take profit" suffix="USD" value={takeProfit} />
          <Field accessibilityLabel="Stop-loss price" onChangeText={(value) => { reset(); setStopLoss(value); }} placeholder="Stop loss" suffix="USD" value={stopLoss} />
        </>
      ) : null}
      {validationError !== null ? (
        <Text accessibilityRole="alert" selectable style={styles.validationError}>
          {validationError}
        </Text>
      ) : null}
      {preparation !== null ? (
        <TradeCollateralStepView loading={phase === 'submitting'} onConfirm={() => void submitPreparation()} step={preparation} />
      ) : plan !== null ? (
        <View style={styles.summary}>
          <TicketRow label="Type" screenReaderLabel="Order type" value={orderTypeText(plan.orderType)} />
          {plan.triggerPrice === null ? null : <TicketRow label="Trigger" value={`$${priceText(plan.triggerPrice)}`} />}
          {plan.orderPrice === null ? null : <TicketRow label="Limit" value={`$${priceText(plan.orderPrice)}`} />}
          <TicketRow label="Size" value={`${plan.amount} ${props.market.baseAsset}`} />
          <TicketRow label="Notional" value={usdc(plan.notionalBaseUnits)} />
          <TicketRow label="Fee" screenReaderLabel="Estimated fee" value={usdc(plan.estimatedFeeBaseUnits)} />
          <ActionButton label="Review and confirm" loading={phase === 'submitting'} onPress={confirm} tone={side === 'long' ? 'positive' : 'negative'} />
        </View>
      ) : phase === 'complete' ? (
        <Text accessibilityLiveRegion="polite" style={styles.success}>Pacifica accepted order {orderId}.</Text>
      ) : (
        <ActionButton label={`Review ${reduceOnly ? 'close' : side}`} loading={phase === 'preparing'} onPress={() => void prepare()} tone={side === 'long' ? 'positive' : 'negative'} />
      )}
      <View style={styles.riskRows}>
        <TicketRow label="Slippage" screenReaderLabel="Maximum slippage" value="0.5%" />
        <TicketRow
          label="Liq."
          screenReaderLabel="Liquidation price"
          value={position?.liquidationPrice ? `$${priceText(position.liquidationPrice)}` : '--'}
        />
        <TicketRow label="Margin" value={reduceOnly ? decimalUsd(position?.margin) : decimalUsd(collateral)} />
        <TicketRow label="Available" value={decimalUsd(portfolio?.availableToSpend)} />
      </View>
      {error !== null ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    </View>
  );
}

function orderTypeText(value: PacificaOrderType): string {
  const words = value.replace('-', ' ');
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
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
  panel: { gap: spacing.xs, paddingVertical: spacing.xs },
  title: { ...typography.heading, color: colors.textPrimary },
  message: { ...typography.bodyCompact, color: colors.textSecondary },
  // `xs`, not `sm`: at half a phone's width the gap between two controls is width the
  // labels inside them need more.
  controls: { flexDirection: 'row', gap: spacing.xs },
  summary: { gap: spacing.xxs, paddingTop: spacing.xs },
  riskRows: {
    gap: spacing.xxs,
    paddingTop: spacing.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  success: { ...typography.bodyCompact, color: colors.positive },
  error: { ...typography.bodyCompact, color: colors.negative },
  validationError: { ...typography.caption, color: colors.negative },
});
