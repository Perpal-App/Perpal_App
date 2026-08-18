import { useEffect, useRef, useState } from 'react';
import { Alert, Text, View } from 'react-native';

import { ActionButton } from '@/components/ui/ActionButton';
import { StatusRow } from '@/components/ui/StatusRow';
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
  StaticControl,
  TicketRow,
  Toggle,
} from '@/features/trade/components/OrderTicketControls';
import { PrivateTradingTicketState } from '@/features/trade/components/PrivateTradingTicketState';
import { TradeCollateralStepView } from '@/features/trade/components/TradeCollateralStepView';
import {
  availableTradingFundsBaseUnits,
  decimalUsd,
  orderConfirmation,
  orderTypeText,
  priceText,
  privateStablecoinText,
  usdcText,
} from '@/features/trade/components/PacificaOrderTicketFormatting';
import { pacificaOrderTicketStyles as styles } from '@/features/trade/components/PacificaOrderTicketStyles';
import { PacificaOrderTypeFields } from '@/features/trade/components/PacificaOrderTypeFields';
import { useTradeActionRecovery } from '@/features/trade/hooks/useTradeActionRecovery';
import { useTradingStablecoinBalances } from '@/features/trade/hooks/useTradingStablecoinBalances';
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
  TradeFundingRequirementError,
  type TradeCollateralStep,
  type TradeFundingRequirement,
} from '@/integrations/perps/tradeCollateral';
import { logTradeError } from '@/integrations/observability/tradeError';
import { publishInAppNotification } from '@/storage/inAppNotifications';
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
  const session = useTradingSession();
  const [action, setAction] = useState<PacificaOrderAction>('open');
  const [side, setSide] = useState<PacificaOrderSide>(props.initialSide ?? 'long');
  const [orderType, setOrderType] = useState<PacificaOrderType>('market');
  const [collateral, setCollateral] = useState('');
  const [leverage, setLeverage] = useState(String(Math.min(5, props.market.maxLeverage)));
  const [limitPrice, setLimitPrice] = useState('');
  const [triggerPrice, setTriggerPrice] = useState('');
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
  const [fundingRequirement, setFundingRequirement] = useState<TradeFundingRequirement | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const marginMode: PacificaMarginMode = props.market.isolatedOnly ? 'isolated' : 'cross';
  const controller = useRef<AbortController | null>(null);
  const recovery = useTradeActionRecovery({
    owner: session.address,
    provider: 'pacifica',
    rpcUrl: props.rpcUrl,
    signer: session.signer,
  });
  const privateBalances = useTradingStablecoinBalances({
    owner: session.address,
    rpcUrl: props.rpcUrl,
    signer: session.signer,
    usdcMint: props.usdcMint,
    usdtMint: props.usdtMint,
  });

  const reset = () => {
    controller.current?.abort();
    setPlan(null);
    setPreparation(null);
    setOrderId(null);
    setError(null);
    setFundingRequirement(null);
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

  const applyPercentage = (next: number) => {
    const available = availableTradingFundsBaseUnits(
      portfolio?.availableToSpend,
      privateBalances.balances,
    );
    if (available === null) return;
    const percent = Math.max(0, Math.min(100, Math.round(next)));
    setCollateral(formatAmount(amountFromBaseUnits((available * BigInt(percent)) / 100n, 6)));
    reset();
  };

  const prepare = async () => {
    if (session.address === null || session.signer === null) {
      session.retryRestore();
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
    setFundingRequirement(null);
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
        if (cause instanceof TradeFundingRequirementError) {
          setFundingRequirement(cause.requirement);
        } else if (cause instanceof AmountError || cause instanceof PacificaOrderValidationError) {
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
      setFundingRequirement(null);
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
      <PrivateTradingTicketState
        baseAsset={props.market.baseAsset}
        onRetry={session.retryRestore}
        status={session.status}
      />
    );
  }

  const position = portfolio?.positions.find(
    (candidate) => candidate.symbol === props.market.venueRef && candidate.side === side,
  );
  const confirm = () => {
    if (plan === null) return;
    const copy = orderConfirmation(plan, props.market.baseAsset);
    Alert.alert(copy.title, copy.message, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Confirm and sign', onPress: () => void submit(plan) },
    ]);
  };
  const reduceOnly = action === 'close';
  const stopOrder = orderType === 'stop-market' || orderType === 'stop-limit';

  return (
    <View style={styles.panel}>
      <View style={styles.controls}>
        <StaticControl
          accessibilityLabel={`Margin mode ${marginMode}`}
          label={marginMode === 'cross' ? 'Cross' : 'Isolated'}
        />
        <Field
          accessibilityLabel="Leverage"
          align="center"
          onChangeText={(value) => { reset(); setLeverage(value); }}
          suffix="×"
          value={leverage}
        />
      </View>
      <PacificaOrderTypeFields
        disabled={reduceOnly}
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
          <Field
            accessibilityLabel="Collateral amount"
            onChangeText={(value) => {
              reset();
              setPresetPercent(null);
              setSliderReset((current) => current + 1);
              setCollateral(value);
            }}
            placeholder="Collateral"
            suffix="USD"
            value={collateral}
          />
          <CollateralSlider
            onChange={(next) => { applyPercentage(next); setPresetPercent(null); }}
            resetSignal={sliderReset}
          />
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
      <Toggle
        label="Reduce only"
        onChange={(value) => {
          reset();
          setAction(value ? 'close' : 'open');
          if (value) {
            setOrderType('market');
            setLimitPrice('');
            setTriggerPrice('');
            setTpSlEnabled(false);
          }
        }}
        value={reduceOnly}
      />
      <Toggle disabled={reduceOnly || stopOrder} label="TP / SL" onChange={(value) => { reset(); setTpSlEnabled(value); }} value={tpSlEnabled} />
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
      {fundingRequirement !== null ? (
        <View accessibilityLiveRegion="polite" style={styles.summary}>
          <StatusRow
            label="Min required"
            selectable
            singleLine
            value={usdcText(fundingRequirement.minimumBaseUnits)}
          />
          <StatusRow
            label="Available"
            selectable
            singleLine
            value={privateStablecoinText({
              usdcBaseUnits: fundingRequirement.usdcAvailableBaseUnits,
              usdtBaseUnits: fundingRequirement.usdtAvailableBaseUnits,
            })}
          />
        </View>
      ) : null}
      {preparation !== null ? (
        <TradeCollateralStepView loading={phase === 'submitting'} onConfirm={() => void submitPreparation()} step={preparation} />
      ) : plan !== null ? (
        <View style={styles.summary}>
          <TicketRow label="Type" screenReaderLabel="Order type" value={orderTypeText(plan.orderType)} />
          {plan.triggerPrice === null ? null : <TicketRow label="Trigger" value={`$${priceText(plan.triggerPrice)}`} />}
          {plan.orderPrice === null ? null : <TicketRow label="Limit" value={`$${priceText(plan.orderPrice)}`} />}
          <TicketRow label="Size" value={`${plan.amount} ${props.market.baseAsset}`} />
          <TicketRow label="Notional" value={usdcText(plan.notionalBaseUnits)} />
          <TicketRow label="Fee" screenReaderLabel="Estimated fee" value={usdcText(plan.estimatedFeeBaseUnits)} />
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
        <TicketRow label="Min. notional" value={decimalUsd(props.market.minOrderSize)} />
        <TicketRow label="Pacifica" screenReaderLabel="Available in Pacifica" value={decimalUsd(portfolio?.availableToSpend)} />
        <TicketRow label="Private" value={privateStablecoinText(privateBalances.balances)} />
      </View>
      {error !== null ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    </View>
  );
}
