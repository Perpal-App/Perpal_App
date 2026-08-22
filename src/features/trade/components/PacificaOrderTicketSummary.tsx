import { Text, View } from 'react-native';

import { SkeletonText } from '@/components/feedback/Skeleton';
import { ActionButton } from '@/components/ui/ActionButton';
import { StatusRow } from '@/components/ui/StatusRow';
import { TicketRow } from '@/features/trade/components/OrderTicketControls';
import {
  decimalUsd,
  priceText,
  privateStablecoinText,
  usdcText,
} from '@/features/trade/components/PacificaOrderTicketFormatting';
import { pacificaOrderTicketStyles as styles } from '@/features/trade/components/PacificaOrderTicketStyles';
import type { TradingStablecoinBalances } from '@/features/trade/hooks/useTradingStablecoinBalances';
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
        value={privateStablecoinText({
          usdcBaseUnits: props.requirement.usdcAvailableBaseUnits,
          usdtBaseUnits: props.requirement.usdtAvailableBaseUnits,
        })}
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
      <TicketRow label="Private" value={privateStablecoinText(props.privateBalances)} />
    </View>
  );
}
