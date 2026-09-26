import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useRetainedValue } from '@/components/motion/useRetainedValue';
import { useSheetScroll } from '@/components/ui/DraggableSheet';
import { formatAmountWithCommas } from '@/domain/money/amount';
import {
  autoCloseSummary,
  positionSizeEstimate,
  usdCentsText,
} from '@/features/trade/components/PacificaOrderTicketFormatting';
import { AmountKeypad } from '@/features/trade/components/orderTicket/AmountKeypad';
import { AutoClosePage } from '@/features/trade/components/orderTicket/AutoClosePage';
import { CollateralCard } from '@/features/trade/components/orderTicket/CollateralCard';
import { DepositHeading } from '@/features/trade/components/orderTicket/DepositHeading';
import { FundingRequirementRows } from '@/features/trade/components/orderTicket/FundingRequirementRows';
import {
  applyKeypadKey,
  entryAmount,
  type KeypadKey,
} from '@/features/trade/components/orderTicket/keypadEntry';
import { LeveragePage } from '@/features/trade/components/orderTicket/LeveragePage';
import { OrderPlacedCard } from '@/features/trade/components/orderTicket/OrderPlacedCard';
import { PercentPresets } from '@/features/trade/components/orderTicket/PercentPresets';
import { PrivateTradingTicketState } from '@/features/trade/components/orderTicket/PrivateTradingTicketState';
import { ReviewPage, type ReviewContent } from '@/features/trade/components/orderTicket/ReviewPage';
import {
  entryBaseUnits,
  reviewBlock,
  usdcBaseUnits,
} from '@/features/trade/components/orderTicket/reviewBlock';
import { TicketBalanceState } from '@/features/trade/components/orderTicket/TicketBalanceState';
import { TicketFigure } from '@/features/trade/components/orderTicket/TicketFigure';
import { TicketOptionCard } from '@/features/trade/components/orderTicket/TicketOptionCard';
import { TicketPage } from '@/features/trade/components/orderTicket/TicketPage';
import { TicketPrimaryAction } from '@/features/trade/components/orderTicket/TicketPrimaryAction';
import {
  autoCloseOn,
  marketOrderDraft,
  presetEntry,
  useOrderTicketDraft,
  type AutoClosePrices,
} from '@/features/trade/hooks/useOrderTicketDraft';
import { usePacificaOrderFlow } from '@/features/trade/hooks/usePacificaOrderFlow';
import { usePacificaTicketAccount } from '@/features/trade/hooks/usePacificaTicketAccount';
import { PACIFICA_MINIMUM_CREDITED_DEPOSIT_BASE_UNITS } from '@/integrations/perps/pacifica/pacificaDeposit';
import type {
  PacificaMarket,
  PacificaMarketSnapshot,
} from '@/integrations/perps/pacifica/pacificaMarketData';
import type {
  PacificaMarginMode,
  PacificaOrderSide,
} from '@/integrations/perps/pacifica/pacificaOrder';
import { spacing } from '@/theme/tokens';

/**
 * Cents. The figure reads as dollars, the balance beside it is shown to the cent and the presets truncate
 * to it, so an entry finer than a cent would be the one figure on the card that nothing else agrees with.
 */
const COLLATERAL_DECIMALS = 2;

/** The two settings that open a page of their own. */
type OptionPage = 'autoClose' | 'leverage';

/**
 * The order ticket: how much, at what leverage, with what exits — for a side already chosen.
 *
 * The side comes from the market's Buy / Sell pair and is fixed for the ticket's life; the order is always
 * an opening market order. What is left is the three things worth deciding here, laid out the way they
 * are decided: the amount at the top in the card the keypad writes into, the two options under it, the
 * figures they come to, and the keypad and its action at the bottom, under the thumb.
 *
 * This component wires rather than draws. The account and its funding rules are `usePacificaTicketAccount`,
 * the entry is `useOrderTicketDraft`, and everything from review to signature is `usePacificaOrderFlow`;
 * each visible piece is its own component. The contract that holds them together is `reset`: every edit
 * calls it beside the change, so a prepared plan never outlives the inputs it was priced for.
 */
export function PacificaOrderTicket(props: {
  readonly apiOrigin: string;
  readonly centralState: string;
  readonly market: PacificaMarket;
  /** Opens the private funding flow, for a deposit that cannot be paid. Omit where there is nowhere to go. */
  readonly onRequestFunding?: (() => void) | undefined;
  readonly programId: string;
  readonly rpcUrl: string;
  readonly side: PacificaOrderSide;
  readonly snapshot: PacificaMarketSnapshot;
  readonly usdcMint: string;
  readonly vault: string;
}) {
  const account = usePacificaTicketAccount({
    apiOrigin: props.apiOrigin,
    rpcUrl: props.rpcUrl,
    usdcMint: props.usdcMint,
  });
  const { session } = account;
  const {
    clearAfterOrder,
    draft,
    restart,
    setAutoClose,
    setEntry,
    setLeverage,
    setPreset,
  } = useOrderTicketDraft(props.market.maxLeverage);
  const [page, setPage] = useState<OptionPage | null>(null);
  // Keys each opening of a page, so one reopened while its last exit is still playing starts from the
  // ticket's current values rather than from whatever was left in it.
  const [pageSession, setPageSession] = useState(0);
  const [rejectSignal, setRejectSignal] = useState(0);
  const sheetScroll = useSheetScroll();
  const marginMode: PacificaMarginMode = props.market.isolatedOnly ? 'isolated' : 'cross';

  const flow = usePacificaOrderFlow({
    draft: marketOrderDraft(draft, props.side, marginMode),
    fundingOnly: account.fundingOnly,
    market: props.market,
    portfolioState: account.portfolioState,
    recovery: account.recovery,
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
  const { phase, placed, plan, preparation, reset } = flow;

  // A new market or a new identity starts the ticket over, and abandons anything in flight for the old one.
  useEffect(() => {
    reset();
    restart(props.market.maxLeverage);
    setPage(null);
    return flow.abortPending;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- market or identity change only
  }, [props.market.maxLeverage, props.market.venueRef, session.address, session.status]);

  // The review is open from the moment it is asked for until the flow has nothing left to show. Memoised,
  // because the retained copy below is compared by identity.
  const review = useMemo<ReviewContent | null>(() => {
    if (phase === 'preparing') return { kind: 'loading' };
    if (plan !== null) return { kind: 'order', plan };
    if (preparation !== null) return { kind: 'collateral', step: preparation };
    return null;
  }, [phase, plan, preparation]);
  const shownReview = useRetainedValue(review);

  if (session.status !== 'ready' || session.address === null || session.signer === null) {
    return (
      <PrivateTradingTicketState
        baseAsset={props.market.baseAsset}
        onRetry={session.retryRestore}
        status={session.status}
      />
    );
  }
  if (!account.settled || account.portfolio === null) {
    return (
      <TicketBalanceState
        failed={account.portfolioState.failed}
        onRetry={account.portfolioState.refresh}
      />
    );
  }

  const { availableBaseUnits: available, cannotFund, fundingOnly: deposit, portfolio } = account;
  const committed = entryBaseUnits(draft.entry);
  const block = reviewBlock({
    availableBaseUnits: available,
    entry: draft.entry,
    minimum: deposit
      ? { baseUnits: PACIFICA_MINIMUM_CREDITED_DEPOSIT_BASE_UNITS, kind: 'deposit' }
      : { baseUnits: usdcBaseUnits(props.market.minOrderSize), kind: 'position', leverage: draft.leverage },
  });
  const markText = `$${formatAmountWithCommas(props.snapshot.price)}`;
  // The condition the order builder checks before it accepts a leverage change, read from the cached
  // portfolio so the leverage page can say it up front. Review re-reads it from a fresh one.
  const hasExposure = portfolio.positions.some((open) => open.symbol === props.market.venueRef) ||
    portfolio.orders.some((order) => order.symbol === props.market.venueRef);
  const pageOpen = page !== null && !deposit;
  // Anything laid over the form takes it out of the accessibility tree. `accessibilityViewIsModal` on the
  // covering page does that for VoiceOver alone; TalkBack reads straight through an absolute view.
  const covered = pageOpen || review !== null || placed !== null;

  const pressKey = (key: KeypadKey) => {
    const next = applyKeypadKey(draft.entry, key, COLLATERAL_DECIMALS);
    if (next === draft.entry) {
      setRejectSignal((count) => count + 1);
      return;
    }
    reset();
    setEntry(next);
  };

  const clearEntry = () => {
    if (draft.entry.length === 0) return;
    reset();
    setEntry('');
  };

  const pickPreset = (percent: number) => {
    if (available === null) return;
    reset();
    setPreset(percent, presetEntry(available, percent));
  };

  // A page draws from the top of the ticket, and the control that opened it sits further down: bring the
  // sheet back up so the page's header is on screen.
  const openPage = (next: OptionPage) => {
    setPageSession((count) => count + 1);
    setPage(next);
    sheetScroll?.scrollToTop();
  };

  const startReview = () => {
    sheetScroll?.scrollToTop();
    void flow.prepare();
  };

  // Both pages hand back a value and leave the ticket to apply it. An unchanged value applies nothing, so
  // leaving a page through its own action does not throw away anything still valid.
  const applyLeverage = (next: number) => {
    setPage(null);
    if (next === draft.leverage) return;
    reset();
    setLeverage(next);
  };

  const applyAutoClose = (next: AutoClosePrices) => {
    setPage(null);
    if (next.takeProfit === draft.takeProfit && next.stopLoss === draft.stopLoss) return;
    reset();
    setAutoClose(next);
  };

  return (
    // Two boxes, so the form can leave the accessibility tree without taking what covers it along. The
    // outer one has no layout of its own; the form is its only in-flow child, so a page at `inset: 0` of it
    // is exactly the form's size.
    <View style={styles.root}>
      <View
        accessibilityElementsHidden={covered}
        importantForAccessibility={covered ? 'no-hide-descendants' : 'auto'}
        style={styles.form}
      >
        <View style={styles.group}>
          {deposit ? <DepositHeading /> : null}
          {cannotFund ? null : (
            <CollateralCard
              available={available === null ? '--' : usdCentsText(available)}
              entry={draft.entry}
              label={deposit ? 'Deposit' : 'Collateral'}
              over={available !== null && committed !== null && committed > available}
              rejectSignal={rejectSignal}
            />
          )}
          <FundingRequirementRows requirement={flow.fundingRequirement ?? account.belowMinimum} />
          {deposit ? null : (
            <>
              <TicketOptionCard
                accessibilityHint="Opens leverage"
                icon="speedometer-outline"
                onPress={() => openPage('leverage')}
                subtitle={`${marginMode === 'cross' ? 'Cross' : 'Isolated'} margin · up to ${props.market.maxLeverage}×`}
                title="Leverage"
                value={`${draft.leverage}×`}
              />
              <TicketOptionCard
                accessibilityHint="Opens take profit and stop loss"
                icon="shield-checkmark-outline"
                onPress={() => openPage('autoClose')}
                subtitle={autoCloseSummary(draft.takeProfit, draft.stopLoss) ?? 'Set take profit or stop loss'}
                title="Auto close"
              />
              {/* The size is marked approximate: review rounds it down to the market's lot. */}
              <View style={styles.figures}>
                <TicketFigure
                  label="Position size"
                  value={positionSizeEstimate(entryAmount(draft.entry), draft.leverage)}
                />
                <TicketFigure label="Mark price" screenReaderLabel="Live mark price" value={markText} />
              </View>
            </>
          )}
        </View>

        <View style={styles.group}>
          {cannotFund ? null : (
            <>
              <PercentPresets onSelect={pickPreset} selected={draft.preset} />
              <AmountKeypad onClear={clearEntry} onKey={pressKey} />
            </>
          )}
          <TicketPrimaryAction
            block={block}
            cannotFund={cannotFund}
            deposit={deposit}
            onRequestFunding={props.onRequestFunding}
            onReview={startReview}
            phase={phase}
            recoveryPending={account.recovery.pending}
            side={props.side}
          />
        </View>
      </View>

      <TicketPage visible={pageOpen && page === 'leverage'}>
        <LeveragePage
          baseAsset={props.market.baseAsset}
          collateral={entryAmount(draft.entry)}
          current={draft.leverage}
          hasExposure={hasExposure}
          key={`leverage-${pageSession}`}
          marginMode={marginMode}
          max={props.market.maxLeverage}
          onApply={applyLeverage}
          onBack={() => setPage(null)}
        />
      </TicketPage>
      <TicketPage visible={pageOpen && page === 'autoClose'}>
        <AutoClosePage
          active={autoCloseOn(draft)}
          initial={{ stopLoss: draft.stopLoss, takeProfit: draft.takeProfit }}
          key={`auto-close-${pageSession}`}
          mark={props.snapshot.price}
          markText={markText}
          onApply={applyAutoClose}
          onBack={() => setPage(null)}
          side={props.side}
          tickSize={props.market.tickSize}
        />
      </TicketPage>
      <TicketPage visible={review !== null}>
        {shownReview === null ? null : (
          <ReviewPage
            baseAsset={props.market.baseAsset}
            content={shownReview}
            deposit={deposit}
            onBack={reset}
            onConfirmOrder={flow.confirm}
            onConfirmStep={() => void flow.submitPreparation()}
            onRefresh={() => void flow.prepare()}
            submitting={phase === 'submitting'}
          />
        )}
      </TicketPage>

      {/* Last, so it covers the pages as well as the form. Dismissing it clears the entry and the exits:
          they were for the order that just landed, and the next one starts from its own. */}
      <OrderPlacedCard
        baseAsset={props.market.baseAsset}
        onDismissed={() => {
          flow.dismissPlaced();
          clearAfterOrder();
        }}
        placed={placed}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flexGrow: 1 },
  // The top group from the top, the keypad group from the bottom. With the sheet's body filling the
  // screen the keypad sits at the thumb on every phone; on one too short for both, they stack and scroll.
  //
  // The spacing is budgeted, not guessed: at these intervals the whole ticket is about 640pt, inside the
  // roughly 650pt body a 6.1-inch iPhone gives the sheet, so the action is on screen without a scroll.
  // Widen any of them and that stops being true.
  form: { flexGrow: 1, justifyContent: 'space-between', gap: spacing.md },
  group: { gap: spacing.xs },
  figures: { gap: spacing.xxs, paddingHorizontal: spacing.xxs },
});
