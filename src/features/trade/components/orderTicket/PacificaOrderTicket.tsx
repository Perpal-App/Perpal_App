import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { LayoutAnimationConfig } from 'react-native-reanimated';

import { AutoCloseIcon } from '@/assets/svg/AutoCloseIcon';
import { Collapsible } from '@/components/motion/Collapsible';
import { MorphView } from '@/components/motion/MorphView';
import { useRetainedValue } from '@/components/motion/useRetainedValue';
import { useSheetScroll } from '@/components/ui/DraggableSheet';
import { formatAmountWithCommas } from '@/domain/money/amount';
import {
  autoCloseSummary,
  positionSizeEstimate,
  usdCentsText,
} from '@/features/trade/components/PacificaOrderTicketFormatting';
import { AmountKeypad } from '@/features/trade/components/orderTicket/AmountKeypad';
import { AutoCloseEditor } from '@/features/trade/components/orderTicket/AutoCloseEditor';
import { autoCloseProblems, firstProblem } from '@/features/trade/components/orderTicket/autoCloseCheck';
import { AutoCloseOutcome } from '@/features/trade/components/orderTicket/AutoCloseOutcome';
import {
  autoCloseEstimates,
  spokenEstimates,
} from '@/features/trade/components/orderTicket/autoClosePnl';
import { CollateralCard } from '@/features/trade/components/orderTicket/CollateralCard';
import { DepositHeading } from '@/features/trade/components/orderTicket/DepositHeading';
import { FundingRequirementRows } from '@/features/trade/components/orderTicket/FundingRequirementRows';
import { entryAmount } from '@/features/trade/components/orderTicket/keypadEntry';
import { LeverageEditor } from '@/features/trade/components/orderTicket/LeverageEditor';
import { OptionCard } from '@/features/trade/components/orderTicket/OptionCard';
import { OrderPlacedCard } from '@/features/trade/components/orderTicket/OrderPlacedCard';
import { PercentPresets } from '@/features/trade/components/orderTicket/PercentPresets';
import { PrivateTradingTicketState } from '@/features/trade/components/orderTicket/PrivateTradingTicketState';
import { ReviewPage, type ReviewContent } from '@/features/trade/components/orderTicket/ReviewPage';
import {
  entryBaseUnits,
  reviewBlock,
  usdcBaseUnits,
} from '@/features/trade/components/orderTicket/reviewBlock';
import { TicketActionButton } from '@/features/trade/components/orderTicket/TicketActionButton';
import { TicketBalanceState } from '@/features/trade/components/orderTicket/TicketBalanceState';
import { TicketFigure } from '@/features/trade/components/orderTicket/TicketFigure';
import { TicketPage } from '@/features/trade/components/orderTicket/TicketPage';
import { TicketPrimaryAction } from '@/features/trade/components/orderTicket/TicketPrimaryAction';
import { ticketTone } from '@/features/trade/components/orderTicket/ticketTone';
import {
  marketOrderDraft,
  presetEntry,
  useOrderTicketDraft,
} from '@/features/trade/hooks/useOrderTicketDraft';
import { usePacificaOrderFlow } from '@/features/trade/hooks/usePacificaOrderFlow';
import { usePacificaTicketAccount } from '@/features/trade/hooks/usePacificaTicketAccount';
import { useTicketEditing } from '@/features/trade/hooks/useTicketEditing';
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
 * The order ticket: how much, at what leverage, with what exits — for a side already chosen.
 *
 * The side comes from the market's Buy / Sell pair and is fixed for the ticket's life; the order is always
 * an opening market order. What is left is laid out the way it is decided: the amount at the top in the
 * card the keypad writes into, the two options under it, the figures they come to, and the keypad and its
 * action at the bottom, under the thumb.
 *
 * The options open where they stand. Tapping one turns that card into its editor in place — its header
 * does not move — and everything below it springs aside: the leverage card grows into the room the keypad
 * leaves, and the auto-close card opens above the keypad, which stays exactly where it was and types its
 * prices instead of the amount. Every moving part is a `MorphView` on the one morph spring, so the whole
 * change lands together, starting on the frame of the tap.
 *
 * This component wires rather than draws. The account is `usePacificaTicketAccount`, the entry
 * `useOrderTicketDraft`, what is open and where the keypad writes `useTicketEditing`, and everything from
 * review to signature `usePacificaOrderFlow`. The contract holding them together is `reset`: every edit
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
  const ticket = useOrderTicketDraft(props.market.maxLeverage);
  const { clearAfterOrder, draft, restart, setPreset } = ticket;
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
  const editing = useTicketEditing({
    actions: ticket,
    disabled: account.fundingOnly,
    draft,
    mark: props.snapshot.price,
    onEdit: reset,
    side: props.side,
    tickSize: props.market.tickSize,
  });

  // A new market or a new identity starts the ticket over, and abandons anything in flight for the old one.
  useEffect(() => {
    reset();
    restart(props.market.maxLeverage);
    editing.restart();
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
  const { editor } = editing;
  const mark = props.snapshot.price;
  const markText = `$${formatAmountWithCommas(mark)}`;
  const collateral = entryAmount(draft.entry);
  const committed = entryBaseUnits(draft.entry);
  // What the exits come to, for the auto-close card while it is closed. Empty until there is an amount,
  // and re-read on every render, so it follows each key of the amount, the leverage and the mark.
  const estimates = autoCloseEstimates({
    collateral,
    leverage: draft.leverage,
    mark,
    prices: draft,
    side: props.side,
  });
  const block = reviewBlock({
    autoCloseValid: firstProblem(autoCloseProblems(draft, props.side, mark, props.market.tickSize)) === null,
    availableBaseUnits: available,
    entry: draft.entry,
    minimum: deposit
      ? { baseUnits: PACIFICA_MINIMUM_CREDITED_DEPOSIT_BASE_UNITS, kind: 'deposit' }
      : { baseUnits: usdcBaseUnits(props.market.minOrderSize), kind: 'position', leverage: draft.leverage },
  });
  // The condition the order builder checks before it accepts a leverage change, read from the cached
  // portfolio so the editor can say it up front. Review re-reads it from a fresh one.
  const hasExposure = portfolio.positions.some((open) => open.symbol === props.market.venueRef) ||
    portfolio.orders.some((order) => order.symbol === props.market.venueRef);
  const tone = ticketTone(deposit, props.side);
  // Anything laid over the form takes it out of the accessibility tree. `accessibilityViewIsModal` on the
  // covering layer does that for VoiceOver alone; TalkBack reads straight through an absolute view.
  const covered = review !== null || placed !== null;

  const pickPreset = (percent: number) => {
    if (available === null) return;
    reset();
    setPreset(percent, presetEntry(available, percent));
  };

  const startReview = () => {
    sheetScroll?.scrollToTop();
    void flow.prepare();
  };

  return (
    // Two boxes, so the form can leave the accessibility tree without taking what covers it along. The
    // outer one has no layout of its own; the form is its only in-flow child, so a layer at `inset: 0` of it
    // is exactly the form's size.
    <View style={styles.root}>
      {/* Nothing plays on the first paint: the ticket arrives inside a sheet that is itself arriving, and
          sections fading in behind that would read as the form loading in pieces. */}
      <LayoutAnimationConfig skipEntering skipExiting>
        <View
          accessibilityElementsHidden={covered}
          importantForAccessibility={covered ? 'no-hide-descendants' : 'auto'}
          style={styles.form}
        >
          <MorphView style={[styles.top, editor === 'leverage' && styles.grow]}>
            {deposit ? <DepositHeading /> : null}
            {cannotFund ? null : (
              <CollateralCard
                available={available === null ? '--' : usdCentsText(available)}
                entry={draft.entry}
                label={deposit ? 'Deposit' : 'Collateral'}
                onPress={editor === null ? undefined : editing.close}
                over={available !== null && committed !== null && committed > available}
                rejectSignal={editing.rejects.collateral}
              />
            )}
            <FundingRequirementRows requirement={flow.fundingRequirement ?? account.belowMinimum} />
            {deposit ? null : (
              <>
                <OptionCard
                  accessibilityHint="Opens leverage"
                  expanded={editor === 'leverage'}
                  fill
                  icon={(glyph) => <Ionicons {...glyph} name="speedometer-outline" />}
                  onToggle={() => editing.toggle('leverage')}
                  subtitle={`${marginMode === 'cross' ? 'Cross' : 'Isolated'} margin · up to ${props.market.maxLeverage}×`}
                  title="Leverage"
                  value={`${draft.leverage}×`}
                >
                  <LeverageEditor
                    baseAsset={props.market.baseAsset}
                    collateral={collateral}
                    hasExposure={hasExposure}
                    marginMode={marginMode}
                    max={props.market.maxLeverage}
                    onChange={editing.changeLeverage}
                    tone={tone}
                    value={draft.leverage}
                  />
                </OptionCard>
                <OptionCard
                  accessibilityHint="Opens take profit and stop loss"
                  expanded={editor === 'autoClose'}
                  icon={(glyph) => <AutoCloseIcon {...glyph} />}
                  onToggle={() => editing.toggle('autoClose')}
                  subtitle={editor === 'autoClose'
                    ? `Mark ${markText}`
                    : autoCloseSummary(entryAmount(draft.takeProfit), entryAmount(draft.stopLoss)) ??
                      'Set take profit or stop loss'}
                  title="Auto close"
                  value={estimates.length === 0 ? undefined : <AutoCloseOutcome estimates={estimates} />}
                  valueLabel={spokenEstimates(estimates)}
                >
                  <AutoCloseEditor
                    collateral={collateral}
                    errors={editing.errors}
                    focus={editing.focus}
                    leverage={draft.leverage}
                    mark={mark}
                    onClear={editing.clearAutoClose}
                    onFocus={editing.focusField}
                    prices={{ stopLoss: draft.stopLoss, takeProfit: draft.takeProfit }}
                    rejects={editing.rejects}
                    side={props.side}
                  />
                </OptionCard>
              </>
            )}
          </MorphView>

          {/* Every section here stays mounted and folds, rather than being added and removed: a section that
              mounted or unmounted would hold still while the cards above sprang past it, and sit across them.
              Folded on the same spring, each is always exactly the room its neighbours are giving up. */}
          <MorphView style={[styles.bottom, editor === 'leverage' && styles.fit]}>
            {/* Only while nothing is open: the leverage editor carries its own position size, and the
                auto-close editor puts the mark in its header. The size is approximate — review rounds it down
                to the market's lot.

                The widest break in the column is under these rather than above them. The figures read with
                the options they summarise, and the presets with the keypad they fill. */}
            <Collapsible collapsed={deposit || editor !== null} spaceAfter={spacing.md}>
              <View style={styles.figures}>
                <TicketFigure label="Position size" value={positionSizeEstimate(collateral, draft.leverage)} />
                <TicketFigure label="Mark price" screenReaderLabel="Live mark price" value={markText} />
              </View>
            </Collapsible>
            <Collapsible collapsed={cannotFund || editor !== null} spaceAfter={spacing.sm}>
              <PercentPresets onSelect={pickPreset} selected={draft.preset} tone={tone} />
            </Collapsible>
            {/* The keypad stays for auto close, which it types into, and folds away for leverage, whose card
                takes its room. */}
            <Collapsible collapsed={cannotFund || editor === 'leverage'} grow spaceAfter={spacing.xs}>
              <AmountKeypad onClear={editing.clearKey} onKey={editing.pressKey} />
            </Collapsible>
            {/* Keyed by mode, so switching swaps one action for the other in the same place, the new one
                fading up over where the old one was. */}
            <MorphView fadeIn key={editor === null ? 'review' : 'done'}>
              {editor === null ? (
                <TicketPrimaryAction
                  block={block}
                  cannotFund={cannotFund}
                  deposit={deposit}
                  onRequestFunding={props.onRequestFunding}
                  onReview={startReview}
                  phase={phase}
                  recoveryPending={account.recovery.pending}
                  side={props.side}
                  tone={tone}
                />
              ) : (
                <TicketActionButton
                  accessibilityHint="Closes the open option"
                  label="Done"
                  onPress={editing.close}
                  tone="neutral"
                />
              )}
            </MorphView>
          </MorphView>
        </View>
      </LayoutAnimationConfig>

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

      {/* Last, so it covers the review as well as the form. Dismissing it clears the entry and the exits:
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
  // The options at their own height and everything left over to the keypad's group — or, with leverage
  // open, to the leverage card, which then needs the room more than a keypad it does not use.
  //
  // Spare height goes to whatever is typing or being edited, never to an empty band between groups. With
  // the keypad at its floor the whole ticket still just fits the body a 6.1-inch iPhone gives the sheet; on
  // anything shorter the sheet scrolls, and on anything taller the keys or the open card get the difference.
  //
  // That fit is a fixed budget. The room under the figures is paid for here and under the keypad, each of
  // which sits beside something that already holds its own space: the figures' rows and the keys' rows both
  // carry their own leading.
  form: { flexGrow: 1, gap: spacing.sm },
  top: { gap: spacing.xs },
  grow: { flexGrow: 1 },
  // No `gap`: every section above the action can fold, and a folded section would still claim its gap.
  // Each carries its own spacing inside its fold instead. `flex-end`, for the forms with no keypad — leverage
  // open, or a deposit that cannot be paid — so the action still sits at the bottom.
  bottom: { flexGrow: 1, justifyContent: 'flex-end' },
  fit: { flexGrow: 0 },
  figures: { gap: spacing.xxs, paddingHorizontal: spacing.xxs },
});
