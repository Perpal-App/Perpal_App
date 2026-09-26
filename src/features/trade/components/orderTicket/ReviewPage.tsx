import { StyleSheet, Text } from 'react-native';

import { MorphView } from '@/components/motion/MorphView';
import { confirmCollateralStep } from '@/features/trade/components/orderTicket/collateralStepCopy';
import { CollateralStepSummary } from '@/features/trade/components/orderTicket/CollateralStepSummary';
import { PreparedOrderSummary } from '@/features/trade/components/orderTicket/PreparedOrderSummary';
import { TicketActionButton } from '@/features/trade/components/orderTicket/TicketActionButton';
import { TicketPageLayout } from '@/features/trade/components/orderTicket/TicketPageLayout';
import { useQuoteExpiry } from '@/features/trade/hooks/useQuoteExpiry';
import type { PacificaOrderPlan } from '@/integrations/perps/pacifica/pacificaOrder';
import {
  tradeCollateralStepCanSubmit,
  type TradeCollateralStep,
} from '@/integrations/perps/tradeCollateral';
import { colors, interfaceType } from '@/theme/tokens';

/** What the review is showing: the prepared order, or a transfer that must come first. */
export type ReviewContent =
  | { readonly kind: 'order'; readonly plan: PacificaOrderPlan }
  | { readonly kind: 'collateral'; readonly step: TradeCollateralStep };

/**
 * The review: the one place a trade or a deposit is read in full before anything is signed.
 *
 * It opens with the prepared object already in hand — there is no loading state — and every figure on it
 * comes off that object, never off the form, so what is read here is what is signed.
 *
 * A quote is short-lived. When it expires the action becomes `Refresh quote` — a fresh quote at the current
 * mark, reviewed again — instead of a confirmation certain to be refused. The expired figures stay on the
 * page while it refreshes. Signing still checks the deadline itself; this only stops the page from offering
 * what cannot work.
 *
 * This page is the confirmation. Its primary action signs and submits the plan it shows — there is no second
 * dialog after it, so every figure that matters is on the page before the button, not behind it. Back
 * abandons the review and is unavailable while a signature is in flight.
 */
export function ReviewPage({
  baseAsset,
  content,
  deposit,
  onBack,
  onConfirmOrder,
  onConfirmStep,
  onRefresh,
  refreshing,
  submitting,
}: {
  readonly baseAsset: string;
  readonly content: ReviewContent;
  /** The deposit form, rather than a trade. */
  readonly deposit: boolean;
  readonly onBack: () => void;
  readonly onConfirmOrder: () => void;
  readonly onConfirmStep: () => void;
  readonly onRefresh: () => void;
  /** A refreshed quote is being prepared. */
  readonly refreshing: boolean;
  readonly submitting: boolean;
}) {
  const expiresAtMs = content.kind === 'order' ? content.plan.expiresAtMs : content.step.plan.expiresAtMs;
  const expired = useQuoteExpiry(expiresAtMs) && !submitting;

  return (
    <TicketPageLayout
      backDisabled={submitting}
      footer={(
        <>
          {expired ? (
            <Text accessibilityLiveRegion="polite" accessibilityRole="alert" style={styles.expired}>
              This quote expired. Refresh it to price the {deposit ? 'deposit' : 'order'} again.
            </Text>
          ) : null}
          {/* Keyed by what it offers, so a change of action fades the new one up in place rather than
              switching its colour and label under the finger. */}
          <MorphView fadeIn key={`${content.kind}-${expired ? 'expired' : 'live'}`}>
            <ReviewAction
              content={content}
              deposit={deposit}
              expired={expired}
              onConfirmOrder={onConfirmOrder}
              onConfirmStep={onConfirmStep}
              onRefresh={onRefresh}
              refreshing={refreshing}
              submitting={submitting}
            />
          </MorphView>
        </>
      )}
      onBack={onBack}
      title={title(content, deposit)}
    >
      {content.kind === 'order' ? (
        <PreparedOrderSummary baseAsset={baseAsset} plan={content.plan} />
      ) : (
        // A different page from an order's, so it fades in rather than appearing.
        <MorphView fadeIn>
          <CollateralStepSummary deposit={deposit} step={content.step} />
        </MorphView>
      )}
    </TicketPageLayout>
  );
}

function ReviewAction(props: {
  readonly content: ReviewContent;
  readonly deposit: boolean;
  readonly expired: boolean;
  readonly onConfirmOrder: () => void;
  readonly onConfirmStep: () => void;
  readonly onRefresh: () => void;
  readonly refreshing: boolean;
  readonly submitting: boolean;
}) {
  const { content } = props;
  if (props.expired) {
    return (
      <TicketActionButton
        disabled={props.refreshing}
        label="Refresh quote"
        loading={props.refreshing}
        onPress={props.onRefresh}
        tone="neutral"
      />
    );
  }
  if (content.kind === 'order') {
    return (
      <TicketActionButton
        label={`Confirm ${content.plan.side}`}
        loading={props.submitting}
        onPress={props.onConfirmOrder}
        tone={content.plan.side === 'long' ? 'positive' : 'negative'}
      />
    );
  }
  const { step } = content;
  return (
    <TicketActionButton
      disabled={!tradeCollateralStepCanSubmit(step)}
      label={props.deposit ? 'Confirm deposit' : 'Move collateral'}
      loading={props.submitting}
      onPress={() => confirmCollateralStep(step, props.onConfirmStep)}
      tone="accent"
    />
  );
}

function title(content: ReviewContent, deposit: boolean): string {
  if (deposit) return 'Review deposit';
  return content.kind === 'collateral' ? 'Move collateral' : 'Review order';
}

const styles = StyleSheet.create({
  expired: { ...interfaceType.caption, color: colors.textSecondary, textAlign: 'center' },
});
