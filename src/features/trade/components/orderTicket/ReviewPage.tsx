import { StyleSheet, Text, View } from 'react-native';

import { ActionButton } from '@/components/ui/ActionButton';
import { StatusRowSkeleton } from '@/components/ui/StatusRow';
import { confirmCollateralStep } from '@/features/trade/components/orderTicket/collateralStepCopy';
import { CollateralStepSummary } from '@/features/trade/components/orderTicket/CollateralStepSummary';
import { PreparedOrderSummary } from '@/features/trade/components/orderTicket/PreparedOrderSummary';
import { TicketPageLayout } from '@/features/trade/components/orderTicket/TicketPageLayout';
import { TicketPanel } from '@/features/trade/components/orderTicket/TicketPanel';
import { useQuoteExpiry } from '@/features/trade/hooks/useQuoteExpiry';
import type { PacificaOrderPlan } from '@/integrations/perps/pacifica/pacificaOrder';
import {
  tradeCollateralStepCanSubmit,
  type TradeCollateralStep,
} from '@/integrations/perps/tradeCollateral';
import { colors, spacing, typography } from '@/theme/tokens';

/** What the review is showing: a quote on its way, the order it produced, or a transfer that must come first. */
export type ReviewContent =
  | { readonly kind: 'loading' }
  | { readonly kind: 'order'; readonly plan: PacificaOrderPlan }
  | { readonly kind: 'collateral'; readonly step: TradeCollateralStep };

/** Widths for the loading rows, varied so a column of placeholders does not read as a grid. */
const SKELETON_ROWS = [
  ['28%', '34%'],
  ['22%', '40%'],
  ['30%', '26%'],
  ['26%', '38%'],
  ['34%', '30%'],
] as const;

/**
 * The review: the one place a trade or a deposit is read in full before anything is signed.
 *
 * It opens the moment review is asked for, with placeholder rows while the quote is built, rather than
 * leaving the reader looking at a spinner on a button. Every figure comes off the prepared object, never
 * off the form, so what is read here is what is signed.
 *
 * A quote is short-lived. When it expires the action becomes `Refresh quote` — a fresh quote at the
 * current mark, reviewed again — instead of a confirmation certain to be refused. Signing still checks
 * the deadline itself; this only stops the page from offering what cannot work.
 *
 * The primary action opens the flow's own confirmation dialog, which is the only path to a signature.
 * Back abandons the review and is unavailable while a signature is in flight.
 */
export function ReviewPage({
  baseAsset,
  content,
  deposit,
  onBack,
  onConfirmOrder,
  onConfirmStep,
  onRefresh,
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
  readonly submitting: boolean;
}) {
  const expiresAtMs = content.kind === 'order'
    ? content.plan.expiresAtMs
    : content.kind === 'collateral' ? content.step.plan.expiresAtMs : null;
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
          <ReviewAction
            content={content}
            deposit={deposit}
            expired={expired}
            onConfirmOrder={onConfirmOrder}
            onConfirmStep={onConfirmStep}
            onRefresh={onRefresh}
            submitting={submitting}
          />
        </>
      )}
      onBack={onBack}
      title={title(content, deposit)}
    >
      {content.kind === 'loading' ? (
        <View accessibilityLabel="Preparing quote" accessible>
          <TicketPanel style={styles.loading}>
            {SKELETON_ROWS.map(([label, value], index) => (
              <StatusRowSkeleton key={index} labelWidth={label} valueWidth={value} />
            ))}
          </TicketPanel>
        </View>
      ) : content.kind === 'order' ? (
        <PreparedOrderSummary baseAsset={baseAsset} plan={content.plan} />
      ) : (
        <CollateralStepSummary deposit={deposit} step={content.step} />
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
  readonly submitting: boolean;
}) {
  const { content } = props;
  if (content.kind === 'loading') {
    return <ActionButton disabled label="Preparing quote" loading onPress={noop} size="large" tone="neutral" />;
  }
  if (props.expired) {
    return <ActionButton label="Refresh quote" onPress={props.onRefresh} size="large" tone="neutral" />;
  }
  if (content.kind === 'order') {
    return (
      <ActionButton
        label={`Confirm ${content.plan.side}`}
        loading={props.submitting}
        onPress={props.onConfirmOrder}
        size="large"
        tone={content.plan.side === 'long' ? 'positive' : 'negative'}
      />
    );
  }
  const { step } = content;
  return (
    <ActionButton
      disabled={!tradeCollateralStepCanSubmit(step)}
      label={props.deposit ? 'Confirm deposit' : 'Move collateral'}
      loading={props.submitting}
      onPress={() => confirmCollateralStep(step, props.onConfirmStep)}
      size="large"
      tone="accent"
    />
  );
}

function title(content: ReviewContent, deposit: boolean): string {
  if (deposit) return 'Review deposit';
  return content.kind === 'collateral' ? 'Move collateral' : 'Review order';
}

/** `ActionButton` always takes a handler; a disabled one never reaches it. */
const noop = () => undefined;

const styles = StyleSheet.create({
  loading: { gap: spacing.sm, paddingVertical: spacing.md, paddingHorizontal: spacing.md },
  expired: { ...typography.caption, color: colors.textSecondary, textAlign: 'center' },
});
