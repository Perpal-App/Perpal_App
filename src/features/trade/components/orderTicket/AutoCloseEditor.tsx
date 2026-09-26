import { StyleSheet, Text, View } from 'react-native';

import { PressableScale } from '@/components/ui/PressableScale';
import type { Amount } from '@/domain/money/amount';
import {
  TRIGGER_FIELD,
  type TriggerKind,
  type TriggerProblems,
} from '@/features/trade/components/orderTicket/autoCloseCheck';
import { estimatedTriggerPnl } from '@/features/trade/components/orderTicket/autoClosePnl';
import { entryAmount } from '@/features/trade/components/orderTicket/keypadEntry';
import { TriggerPriceField } from '@/features/trade/components/orderTicket/TriggerPriceField';
import type { AutoClosePrices } from '@/features/trade/hooks/useOrderTicketDraft';
import {
  triggerSideOfMark,
  type PacificaOrderSide,
} from '@/integrations/perps/pacifica/pacificaOrderValidation';
import { colors, spacing, typography } from '@/theme/tokens';

/** Take profit in the gain colour and stop loss in the loss colour, whatever side the ticket is on. */
const FIELDS: readonly {
  readonly kind: TriggerKind;
  readonly label: string;
  readonly spoken: string;
  readonly tone: 'negative' | 'positive';
}[] = [
  { kind: 'take-profit', label: 'TAKE PROFIT', spoken: 'Take profit price', tone: 'positive' },
  { kind: 'stop-loss', label: 'STOP LOSS', spoken: 'Stop loss price', tone: 'negative' },
];

/**
 * The auto-close editor, inside the auto-close card when it is open: a take profit and a stop loss side by
 * side, typed on the ticket's own keypad, which stays exactly where it was underneath.
 *
 * Each field shows the estimated profit or loss at its price, sized from the collateral and leverage on the
 * ticket. Controlled and live — each key is the ticket's price at once. Nothing here decides validity: the
 * ticket checks the prices with the order builder's own rule when the card is left, and passes back any
 * reason.
 */
export function AutoCloseEditor({
  collateral,
  errors,
  focus,
  leverage,
  mark,
  onClear,
  onFocus,
  prices,
  rejects,
  side,
}: {
  /** What is entered on the ticket, as a plain decimal: the size the estimates are taken from. */
  readonly collateral: string;
  readonly errors: TriggerProblems;
  readonly focus: TriggerKind;
  readonly leverage: number;
  readonly mark: Amount;
  readonly onClear: () => void;
  readonly onFocus: (kind: TriggerKind) => void;
  readonly prices: AutoClosePrices;
  readonly rejects: Readonly<Record<TriggerKind, number>>;
  readonly side: PacificaOrderSide;
}) {
  const hasAny = prices.takeProfit.length > 0 || prices.stopLoss.length > 0;

  return (
    <View style={styles.editor}>
      <View style={styles.fields}>
        {FIELDS.map(({ kind, label, spoken, tone }) => {
          const entry = prices[TRIGGER_FIELD[kind]];
          return (
            <TriggerPriceField
              active={focus === kind}
              entry={entry}
              error={errors[kind]}
              hint={triggerSideOfMark(kind, side) === 'above' ? 'Above mark' : 'Below mark'}
              key={kind}
              label={label}
              onPress={() => onFocus(kind)}
              pnl={estimatedTriggerPnl({ collateral, leverage, mark, price: entryAmount(entry), side })}
              rejectSignal={rejects[kind]}
              spokenLabel={spoken}
              tone={tone}
            />
          );
        })}
      </View>
      <View style={styles.footer}>
        {/* Careful not to promise more than the order does: the figures are estimates before fees, and each
            price triggers a close rather than a fill at it. */}
        <Text style={styles.note}>Est. PnL before fees. Fill not guaranteed.</Text>
        {hasAny ? (
          <PressableScale
            accessibilityLabel="Clear take profit and stop loss"
            accessibilityRole="button"
            hitSlop={12}
            onPress={onClear}
          >
            <Text style={styles.clear}>Clear</Text>
          </PressableScale>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Tighter than the card's own rhythm: the fields carry their estimate under the price, and this keeps the
  // open card short enough that the keypad and Done stay in view on a 6.1-inch phone.
  editor: { gap: spacing.xs },
  // Top-aligned, so an error under one field grows its own column without dragging the other down.
  fields: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  note: { ...typography.caption, flexShrink: 1, color: colors.textMuted },
  clear: { ...typography.label, color: colors.accentSoft },
});
