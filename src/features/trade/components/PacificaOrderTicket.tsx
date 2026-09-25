import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { ActionButton } from '@/components/ui/ActionButton';
import {
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
import { availableTradingFundsBaseUnits } from '@/features/trade/components/PacificaOrderTicketFormatting';
import { pacificaOrderTicketStyles as styles } from '@/features/trade/components/PacificaOrderTicketStyles';
import { PacificaOrderTypeFields } from '@/features/trade/components/PacificaOrderTypeFields';
import {
  PacificaBalanceState,
  PacificaFundingRequirementRows,
  PacificaPreparedOrder,
  PacificaRiskRows,
  PacificaTicketHeading,
} from '@/features/trade/components/PacificaOrderTicketSummary';
import { usePacificaOrderFlow } from '@/features/trade/hooks/usePacificaOrderFlow';
import { useTradeActionRecovery } from '@/features/trade/hooks/useTradeActionRecovery';
import { usePacificaTicketPortfolio } from '@/features/trade/hooks/usePacificaTicketPortfolio';
import { useTradingStablecoinBalances } from '@/features/trade/hooks/useTradingStablecoinBalances';
import { PACIFICA_MINIMUM_CREDITED_DEPOSIT_BASE_UNITS } from '@/integrations/perps/pacifica/pacificaDeposit';
import type { PacificaMarket, PacificaMarketSnapshot } from '@/integrations/perps/pacifica/pacificaMarketData';
import type { PacificaPortfolioSnapshot } from '@/integrations/perps/pacifica/pacificaPortfolio';
import type {
  PacificaMarginMode,
  PacificaOrderAction,
  PacificaOrderSide,
  PacificaOrderType,
} from '@/integrations/perps/pacifica/pacificaOrder';
import { useTradingSession } from '@/wallet/trading/TradingSessionProvider';

export function PacificaOrderTicket(props: {
  readonly apiOrigin: string;
  readonly centralState: string;
  readonly initialSide?: PacificaOrderSide;
  readonly market: PacificaMarket;
  /**
   * Opens the private funding flow, for the state where the deposit this ticket is offering cannot be
   * paid. Omit where the caller has nowhere to send the reader.
   */
  readonly onRequestFunding?: (() => void) | undefined;
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
  const marginMode: PacificaMarginMode = props.market.isolatedOnly ? 'isolated' : 'cross';
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
  // A zero `availableToSpend` is not an unfunded account: open margin, pending risk changes, or reserved
  // collateral can consume spendable funds while the account still exists. The first-funding screen is
  // for an account with no credited cash/activity evidence; actual order insufficiency is checked during
  // preparation against a fresh snapshot.
  const fundingOnly = portfolio !== null && !hasCreditedPacificaCollateral(portfolio);
  // `null` while the balance is still being read. Insufficiency is a claim about a number, so it waits
  // for the number rather than assuming zero — a ticket that flashed "Insufficient funds" on every open
  // and then corrected itself would be worse than the button it replaces.
  const privateUsdc = privateBalances.balances?.usdcBaseUnits ?? null;
  /**
   * The deposit on offer cannot be paid, whatever amount is typed.
   *
   * Pacifica does not credit deposits below its minimum, so a private balance under that floor cannot
   * produce a valid deposit at any size. This used to be discoverable only by tapping: the ticket
   * offered "Review deposit" as its primary accent action, the preparation threw
   * `TradeFundingRequirementError`, and the rejection was deliberately quiet. A button that is the
   * brightest thing on the card and cannot succeed is the wrong shape for that state.
   */
  const cannotFund = fundingOnly && privateUsdc !== null &&
    privateUsdc < PACIFICA_MINIMUM_CREDITED_DEPOSIT_BASE_UNITS;
  // Shown up front rather than only after a failed attempt, so the two figures that explain the block
  // are on screen with it. The flow's own requirement wins once it has one: that came from the venue.
  const belowMinimum = cannotFund && privateUsdc !== null
    ? {
      minimumBaseUnits: PACIFICA_MINIMUM_CREDITED_DEPOSIT_BASE_UNITS,
      usdcAvailableBaseUnits: privateUsdc,
    }
    : null;
  // Every stage between a filled-in ticket and a submitted order. The form below owns what the reader
  // typed; this owns what is done with it, and `reset` is the contract between them — it drops any
  // prepared plan, so no edit here can leave a plan priced for inputs that have changed.
  const flow = usePacificaOrderFlow({
    draft: {
      action, collateral, leverage, limitPrice, marginMode, orderType, side,
      stopLoss, takeProfit, tpSlEnabled, triggerPrice,
    },
    fundingOnly,
    market: props.market,
    portfolioState,
    recovery,
    snapshot: props.snapshot,
    venue: {
      apiOrigin: props.apiOrigin,
      centralState: props.centralState,
      programId: props.programId,
      rpcUrl: props.rpcUrl,
      usdcMint: props.usdcMint,
      vault: props.vault,
    },
  });
  const { phase, plan, preparation } = flow;
  const reset = flow.reset;

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
    return flow.abortPending;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- market or identity change only
  }, [props.market.maxLeverage, props.market.venueRef, session.address, session.status]);

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

  if (session.status !== 'ready' || session.address === null || session.signer === null) {
    return (
      <PrivateTradingTicketState
        baseAsset={props.market.baseAsset}
        onRetry={session.retryRestore}
        status={session.status}
      />
    );
  }

  // Both facts or neither.
  //
  // The venue balance alone used to be enough to render, so the moment it arrived saying "nothing
  // credited" the ticket drew the deposit form — a field, a slider and four presets — while the wallet
  // balance was still in flight. When that landed at zero the whole form was replaced by "Insufficient
  // funds". Two reveals for one answer, and the first was wrong.
  //
  // `fundingOnly` is the only branch that needs the second fact: a tradable account's form does not
  // depend on the wallet at all, so it still renders as soon as the venue answers. With both values now
  // seeded from their caches this wait is usually zero frames, not a round trip.
  if (
    portfolio === null ||
    (fundingOnly && (privateUsdc === null || portfolioState.checking))
  ) {
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
  const reduceOnly = action === 'close';
  /** `ActionButton` always takes a handler; a disabled one never reaches it. */
  const noop = () => undefined;
  const stopOrder = orderType === 'stop-market' || orderType === 'stop-limit';

  return (
    <View style={styles.panel}>
      <PacificaTicketHeading fundingOnly={fundingOnly} />
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
      {/* `cannotFund` hides the amount controls as well as changing the button. A field, a slider and
          four percentage presets are all ways of choosing how much of a balance to commit, and there is
          no balance — every one of them would be a control whose only possible value is zero. */}
      {reduceOnly || cannotFund ? null : (
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
      {recovery.pending && fundingOnly ? (
        <ActionButton
          disabled
          label={phase === 'indexing' ? 'Pacifica crediting funds' : 'Deposit confirming'}
          loading
          onPress={noop}
          tone="neutral"
        />
      ) : preparation !== null ? (
        <TradeCollateralStepView loading={phase === 'submitting'} onConfirm={() => void flow.submitPreparation()} step={preparation} />
      ) : plan !== null ? (
        <PacificaPreparedOrder
          baseAsset={props.market.baseAsset}
          loading={phase === 'submitting'}
          onConfirm={flow.confirm}
          plan={plan}
        />
      ) : cannotFund ? (
        // The blocked state and its remedy on one line. `Insufficient funds` takes the room and says
        // what is wrong; `Add funds` sizes to its own label and is the only thing here that can be
        // pressed. Two full-width buttons stacked said the same pair of things in twice the height.
        <View style={styles.controls}>
          <ActionButton
            // `negative` under `disabled` reads as blocked rather than as inviting. The accent
            // "Review deposit" is reserved for a deposit that can actually be made.
            disabled
            label="Insufficient funds"
            onPress={noop}
            style={styles.grow}
            tone="negative"
          />
          {props.onRequestFunding === undefined ? null : (
            <ActionButton
              accessibilityHint="Opens the private funding flow"
              label="Add funds"
              onPress={props.onRequestFunding}
              tone="accent"
            />
          )}
        </View>
      ) : (
        <ActionButton
          label={fundingOnly ? 'Review deposit' : `Review ${reduceOnly ? 'close' : side}`}
          loading={phase === 'preparing'}
          onPress={() => void flow.prepare()}
          tone={fundingOnly ? 'accent' : side === 'long' ? 'positive' : 'negative'}
        />
      )}

      {/* Below the action, not above it: the figures explain the state the button is reporting. */}
      <PacificaFundingRequirementRows requirement={flow.fundingRequirement ?? belowMinimum} />
      <PacificaRiskRows
        collateral={collateral}
        fundingBlocked={cannotFund}
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

function hasCreditedPacificaCollateral(portfolio: PacificaPortfolioSnapshot): boolean {
  return parseAmount(portfolio.balance, 6).baseUnits > 0n ||
    portfolio.positionsCount > 0 ||
    portfolio.ordersCount > 0 ||
    portfolio.stopOrdersCount > 0;
}
