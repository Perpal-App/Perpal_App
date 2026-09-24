import { Text, View } from 'react-native';

import { SkeletonText } from '@/components/feedback/Skeleton';
import { ActionButton } from '@/components/ui/ActionButton';
import { StatusRow } from '@/components/ui/StatusRow';
import { TicketRow } from '@/features/trade/components/OrderTicketControls';
import {
  accountHealthText,
  decimalUsd,
  orderTypeText,
  priceText,
  privateUsdcText,
  usdcText,
} from '@/features/trade/components/PacificaOrderTicketFormatting';
import { pacificaOrderTicketStyles as styles } from '@/features/trade/components/PacificaOrderTicketStyles';
import type { TradingStablecoinBalances } from '@/features/trade/hooks/useTradingStablecoinBalances';
import type {
  PacificaOrderPlan,
} from '@/integrations/perps/pacifica/pacificaOrder';
import type {
  PacificaPortfolioSnapshot,
  PacificaPosition,
} from '@/integrations/perps/pacifica/pacificaPortfolio';
import type { TradeFundingRequirement } from '@/integrations/perps/tradeCollateral';

export function PacificaBalanceState(props: {
  readonly failed: boolean;
  readonly onRetry: () => void;
}) {
  return !props.failed ? (
    <View accessibilityLabel="Loading Pacifica balance" style={styles.loading}>
      <SkeletonText role="heading" width={92} />
      <SkeletonText role="label" width="100%" />
      <SkeletonText role="label" width="100%" />
    </View>
  ) : (
    <View style={styles.loading}>
      <Text accessibilityRole="alert" style={styles.error}>Pacifica balance refresh failed.</Text>
      <ActionButton label="Retry balance" onPress={props.onRetry} tone="neutral" />
    </View>
  );
}

/**
 * What the ticket is, and — when it is a deposit form — why.
 *
 * The heading alone used to be the entire explanation. Tapping `Buy / Long` on a market opened a sheet
 * titled for that side whose whole body was a form headed `Deposit`, with nothing anywhere saying what
 * the deposit was for. The reasonable conclusion from that screen is that the deposit is a bug, because
 * the account is keyed to a wallet that already holds USDC.
 *
 * It is not a bug, and the line says the part that was missing: the venue custodies margin itself.
 * Signing for a Pacifica account and having collateral credited to it are two different things, and the
 * wallet balance shown two rows below as `Private USDC` is the money that has not been credited yet.
 */
export function PacificaTicketHeading(props: { readonly fundingOnly: boolean }) {
  return (
    <>
      <Text accessibilityRole="header" style={styles.title}>
        {props.fundingOnly ? 'Deposit collateral' : 'Order'}
      </Text>
      {props.fundingOnly ? (
        // One short line. It was two sentences, and a second note further down explained Umbra as
        // well — three lines of prose above a form with four controls. This keeps the one fact a
        // reader cannot infer from the screen: the money has to move into the venue, not just exist.
        <Text style={styles.note}>Pacifica holds margin in its own vault.</Text>
      ) : null}
    </>
  );
}

/**
 * The two figures behind a deposit that cannot be paid.
 *
 * Just the numbers. The remedy used to live here as well — a sentence about Umbra and a full-width
 * "Add private funds" button — which stacked three elements under a button already saying the same
 * thing. The action moved up beside the blocked one, where a reader looking at "Insufficient funds"
 * finds it without reading past it.
 */
export function PacificaFundingRequirementRows(props: {
  readonly requirement: TradeFundingRequirement | null;
}) {
  if (props.requirement === null) return null;
  return (
    <View accessibilityLiveRegion="polite" style={styles.summary}>
      <StatusRow
        label="Min required"
        selectable
        singleLine
        value={usdcText(props.requirement.minimumBaseUnits)}
      />
      <StatusRow
        label="Available"
        selectable
        singleLine
        value={usdcText(props.requirement.usdcAvailableBaseUnits)}
      />
    </View>
  );
}

export function PacificaPreparedOrder(props: {
  readonly baseAsset: string;
  readonly loading: boolean;
  readonly onConfirm: () => void;
  readonly plan: PacificaOrderPlan;
}) {
  const risk = props.plan.risk;
  return (
    <View style={styles.summary}>
      <TicketRow label="Type" screenReaderLabel="Order type" value={orderTypeText(props.plan.orderType)} />
      {props.plan.triggerPrice === null ? null : (
        <TicketRow label="Trigger" value={`$${priceText(props.plan.triggerPrice)}`} />
      )}
      {props.plan.orderPrice === null ? null : (
        <TicketRow label="Limit" value={`$${priceText(props.plan.orderPrice)}`} />
      )}
      <TicketRow label="Size" value={`${props.plan.amount} ${props.baseAsset}`} />
      <TicketRow label="Notional" value={usdcText(props.plan.notionalBaseUnits)} />
      <TicketRow label="Fee" screenReaderLabel="Estimated fee" value={usdcText(props.plan.estimatedFeeBaseUnits)} />
      {risk === null ? null : (
        <>
          <TicketRow label="Initial margin" value={usdcText(risk.initialMarginBaseUnits)} />
          <TicketRow label="Margin after" value={usdcText(risk.projectedMarginUsedBaseUnits)} />
          <TicketRow label="Available after" value={usdcText(risk.projectedAvailableBaseUnits)} />
          <TicketRow label="Maint. buffer" screenReaderLabel="Maintenance margin buffer" value={usdcText(risk.maintenanceHeadroomBaseUnits)} />
          <TicketRow label="Account health" value={accountHealthText(risk.accountHealthBps)} />
          <TicketRow
            label="Projected liq."
            screenReaderLabel="Projected liquidation price"
            value={risk.liquidationPrice === null ? 'None above $0' : `$${priceText(risk.liquidationPrice)}`}
          />
        </>
      )}
      <ActionButton
        label="Review and confirm"
        loading={props.loading}
        onPress={props.onConfirm}
        tone={props.plan.side === 'long' ? 'positive' : 'negative'}
      />
    </View>
  );
}

export function PacificaRiskRows(props: {
  readonly collateral: string;
  readonly fundingOnly: boolean;
  readonly minimumOrderSize: string;
  readonly portfolio: PacificaPortfolioSnapshot;
  readonly position: PacificaPosition | undefined;
  readonly privateBalances: TradingStablecoinBalances | null;
  readonly reduceOnly: boolean;
}) {
  return (
    <View style={styles.riskRows}>
      {props.fundingOnly ? null : (
        <TicketRow label="Slippage" screenReaderLabel="Maximum slippage" value="0.5%" />
      )}
      {props.fundingOnly ? null : (
        <TicketRow
          label="Liq."
          screenReaderLabel="Liquidation price"
          value={props.position?.liquidationPrice
            ? `$${priceText(props.position.liquidationPrice)}`
            : '--'}
        />
      )}
      <TicketRow
        label={props.fundingOnly ? 'Deposit' : 'Margin'}
        value={props.reduceOnly ? decimalUsd(props.position?.margin) : decimalUsd(props.collateral)}
      />
      {props.fundingOnly ? null : (
        <TicketRow label="Min. notional" value={decimalUsd(props.minimumOrderSize)} />
      )}
      <TicketRow
        label="Pacifica"
        screenReaderLabel="Available in Pacifica"
        value={decimalUsd(props.portfolio.availableToSpend)}
      />
      <TicketRow label="Private USDC" value={privateUsdcText(props.privateBalances)} />
    </View>
  );
}
