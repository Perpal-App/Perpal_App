import { useEffect, useRef, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { ActionButton } from '@/components/ui/ActionButton';
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
  Toggle,
} from '@/features/trade/components/OrderTicketControls';
import { PrivateTradingTicketState } from '@/features/trade/components/PrivateTradingTicketState';
import { TradeCollateralStepView } from '@/features/trade/components/TradeCollateralStepView';
import {
  availableTradingFundsBaseUnits,
  orderConfirmation,
  orderSubmissionNotification,
} from '@/features/trade/components/PacificaOrderTicketFormatting';
import { pacificaOrderTicketStyles as styles } from '@/features/trade/components/PacificaOrderTicketStyles';
import { PacificaOrderTypeFields } from '@/features/trade/components/PacificaOrderTypeFields';
import {
  PacificaBalanceState,
  PacificaFundingRequirementRows,
  PacificaPreparedOrder,
  PacificaRiskRows,
} from '@/features/trade/components/PacificaOrderTicketSummary';
import { useTradeActionRecovery } from '@/features/trade/hooks/useTradeActionRecovery';
import { usePacificaTicketPortfolio } from '@/features/trade/hooks/usePacificaTicketPortfolio';
import { useTradingStablecoinBalances } from '@/features/trade/hooks/useTradingStablecoinBalances';
import type { PacificaMarket, PacificaMarketSnapshot } from '@/integrations/perps/pacifica/pacificaMarketData';
import {
  preparePacificaOrder,
  PacificaCommandPendingError,
  submitPacificaOrder,
  validatePacificaOrderDraft,
  PacificaOrderValidationError,
  type PacificaMarginMode,
  type PacificaOrderPlan,
  type PacificaOrderAction,
  type PacificaOrderSide,
  type PacificaOrderType,
} from '@/integrations/perps/pacifica/pacificaOrder';
import { fetchFreshPacificaPortfolio } from '@/integrations/perps/pacifica/pacificaPortfolio';
import {
  preparePacificaTradeCollateral,
  submitTradeCollateralStep,
  TradeFundingRequirementError,
  type TradeCollateralStep,
  type TradeFundingRequirement,
} from '@/integrations/perps/tradeCollateral';
import { logTradeError } from '@/integrations/observability/tradeError';
import {
  captureInAppNotificationScope,
  publishInAppNotification,
} from '@/storage/inAppNotifications';
import { showAppToast } from '@/storage/appToast';
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
  readonly usdcMint: string;
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
  const [phase, setPhase] = useState<Phase>('idle');
  const [plan, setPlan] = useState<PacificaOrderPlan | null>(null);
  const [preparation, setPreparation] = useState<TradeCollateralStep | null>(null);
  const [fundingRequirement, setFundingRequirement] = useState<TradeFundingRequirement | null>(null);
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
  });
  const portfolioState = usePacificaTicketPortfolio({
    account: session.address,
    apiOrigin: props.apiOrigin,
    enabled: session.status === 'ready',
    marketRef: props.market.venueRef,
  });
  const portfolio = portfolioState.portfolio;
  const reset = () => {
    controller.current?.abort();
    setPlan(null);
    setPreparation(null);
    setFundingRequirement(null);
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
    return () => controller.current?.abort();
  }, [props.market.maxLeverage, props.market.venueRef, session.address, session.status]);

  const fundingOnly = portfolio !== null &&
    parseAmount(portfolio.availableToSpend, 6).baseUnits <= 0n;

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
      if (fundingOnly) {
        const amount = parseAmount(collateral, 6).baseUnits;
        if (amount <= 0n) throw new AmountError('Enter a deposit greater than zero.');
      } else {
        validatePacificaOrderDraft({
          action, collateral, leverage, market: props.market, orderPrice: limitPrice, orderType, side,
          snapshot: props.snapshot, stopLossPrice: stopLoss, takeProfitPrice: takeProfit,
          tpSlEnabled, triggerPrice,
        });
      }
    } catch (cause) {
      showAppToast({
        outcome: 'error', title: fundingOnly ? 'Review deposit' : 'Review order',
        message: cause instanceof Error ? cause.message : 'Review the order inputs.',
      });
      return;
    }
    const abort = new AbortController();
    controller.current?.abort();
    controller.current = abort;
    setPhase('preparing');
    setPlan(null);
    setPreparation(null);
    setFundingRequirement(null);
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
          usdcMint: props.usdcMint,
          vault: props.vault,
        });
        if (next !== null) {
          setPreparation(next);
          setPhase('prepared');
          return;
        }
        if (fundingOnly) {
          throw new Error('Pacifica already has available trading balance. Refresh the ticket.');
        }
      }
      const latestPortfolio = await fetchFreshPacificaPortfolio(
        props.apiOrigin,
        session.address,
        abort.signal,
      );
      portfolioState.update(latestPortfolio);
      const nextPlan = await preparePacificaOrder({
        account: session.address,
        action,
        apiOrigin: props.apiOrigin,
        collateralBaseUnits,
        leverage: action === 'open' ? Number(leverage) : 1,
        marginMode,
        market: props.market,
        orderPrice: limitPrice,
        orderType,
        portfolio: latestPortfolio,
        side,
        snapshot: props.snapshot,
        signal: abort.signal,
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
          showAppToast({ outcome: 'error', title: 'Review order', message: cause.message });
        } else {
          logTradeError('pacifica', 'preparation', cause);
          showAppToast({
            outcome: 'error', title: 'Preparation failed',
            message: cause instanceof Error ? cause.message : 'Pacifica order preview failed.',
          });
        }
        setPhase('idle');
      }
    }
  };

  const submitPreparation = async () => {
    if (preparation === null || session.address === null || session.signer === null) return;
    const scopeToken = captureInAppNotificationScope();
    const abort = new AbortController();
    controller.current = abort;
    setPhase('submitting');
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
      setPhase('complete');
      setFundingRequirement(null);
      publishInAppNotification({
        kind: 'funding', outcome: 'success', title: 'Trading collateral confirmed',
        message: 'Pacifica is updating the available trading balance.',
        scopeToken,
      });
    } catch (cause) {
      if (!abort.signal.aborted) {
        logTradeError('pacifica', 'submission', cause);
        setPhase('idle');
        publishInAppNotification({
          kind: 'funding', outcome: 'error', title: 'Trading collateral not confirmed',
          message: cause instanceof Error ? cause.message : 'Review the collateral step.',
          scopeToken,
        });
      }
    }
  };

  const submit = async (confirmed: PacificaOrderPlan) => {
    if (session.address === null || session.signer === null) return;
    const scopeToken = captureInAppNotificationScope();
    setPhase('submitting');
    try {
      const result = await submitPacificaOrder({
        account: session.address,
        apiOrigin: props.apiOrigin,
        intentStartedAtMs: performance.now(),
        plan: confirmed,
        signer: session.signer,
      });
      setPlan(null);
      setPhase('idle');
      portfolioState.refresh();
      publishInAppNotification({
        correlations: [{ namespace: 'pacifica-order', value: confirmed.clientOrderId }],
        ...orderSubmissionNotification(confirmed, props.market.baseAsset, result.orderStatus),
        scopeToken,
      });
    } catch (cause) {
      if (!(cause instanceof PacificaCommandPendingError)) {
        logTradeError('pacifica', 'submission', cause);
      }
      setPlan(null);
      setPhase('idle');
      publishInAppNotification({
        correlations: [{ namespace: 'pacifica-order', value: confirmed.clientOrderId }],
        kind: 'trade',
        outcome: cause instanceof PacificaCommandPendingError ? 'info' : 'error',
        status: cause instanceof PacificaCommandPendingError ? 'submitted' : 'failed',
        title: cause instanceof PacificaCommandPendingError ? 'Order status pending' : 'Order needs review',
        message: cause instanceof Error ? cause.message : `${props.market.baseAsset} order needs review.`,
        scopeToken,
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

  if (portfolio === null) {
    return (
      <PacificaBalanceState
        failed={portfolioState.failed}
        onRetry={portfolioState.refresh}
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
      <Text accessibilityRole="header" style={styles.title}>{fundingOnly ? 'Deposit' : 'Order'}</Text>
      {fundingOnly ? null : <View style={styles.controls}>
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
      </View>}
      {fundingOnly ? null : <PacificaOrderTypeFields
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
      />}
      {fundingOnly ? null : <View style={styles.controls}>
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
      </View>}
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
      {fundingOnly ? null : <Toggle
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
      />}
      {fundingOnly ? null : <Toggle disabled={reduceOnly || stopOrder} label="TP / SL" onChange={(value) => { reset(); setTpSlEnabled(value); }} value={tpSlEnabled} />}
      {!fundingOnly && tpSlEnabled && !reduceOnly ? (
        <>
          <Field accessibilityLabel="Take-profit price" onChangeText={(value) => { reset(); setTakeProfit(value); }} placeholder="Take profit" suffix="USD" value={takeProfit} />
          <Field accessibilityLabel="Stop-loss price" onChangeText={(value) => { reset(); setStopLoss(value); }} placeholder="Stop loss" suffix="USD" value={stopLoss} />
        </>
      ) : null}
      <PacificaFundingRequirementRows requirement={fundingRequirement} />
      {preparation !== null ? (
        <TradeCollateralStepView loading={phase === 'submitting'} onConfirm={() => void submitPreparation()} step={preparation} />
      ) : plan !== null ? (
        <PacificaPreparedOrder
          baseAsset={props.market.baseAsset}
          loading={phase === 'submitting'}
          onConfirm={confirm}
          plan={plan}
        />
      ) : (
        <ActionButton
          label={fundingOnly
            ? phase === 'complete' ? 'Refresh balance' : 'Review deposit'
            : `Review ${reduceOnly ? 'close' : side}`}
          loading={phase === 'preparing'}
          onPress={phase === 'complete' && fundingOnly
            ? () => {
                setPhase('idle');
                portfolioState.refresh();
              }
            : () => void prepare()}
          tone={fundingOnly ? 'accent' : side === 'long' ? 'positive' : 'negative'}
        />
      )}
      <PacificaRiskRows
        collateral={collateral}
        fundingOnly={fundingOnly}
        minimumOrderSize={props.market.minOrderSize}
        portfolio={portfolio}
        position={position}
        privateBalances={privateBalances.balances}
        reduceOnly={reduceOnly}
      />
    </View>
  );
}
