import { useState } from 'react';
import { StyleSheet, Text } from 'react-native';

import { ActionButton } from '@/components/ui/ActionButton';
import { PressableScale } from '@/components/ui/PressableScale';
import type { Amount } from '@/domain/money/amount';
import { markDistanceText } from '@/features/trade/components/PacificaOrderTicketFormatting';
import { AmountKeypad } from '@/features/trade/components/orderTicket/AmountKeypad';
import {
  applyKeypadKey,
  entryAmount,
  stepDecimals,
  type KeypadKey,
} from '@/features/trade/components/orderTicket/keypadEntry';
import { TicketFigure } from '@/features/trade/components/orderTicket/TicketFigure';
import { TicketPageLayout } from '@/features/trade/components/orderTicket/TicketPageLayout';
import { TriggerPriceField } from '@/features/trade/components/orderTicket/TriggerPriceField';
import type { AutoClosePrices } from '@/features/trade/hooks/useOrderTicketDraft';
import {
  PacificaOrderValidationError,
  triggerSideOfMark,
  validateTriggerPrice,
  type PacificaOrderSide,
} from '@/integrations/perps/pacifica/pacificaOrderValidation';
import { colors, spacing, typography } from '@/theme/tokens';

type TriggerKind = 'take-profit' | 'stop-loss';

const FIELDS = {
  'take-profit': { label: 'TAKE PROFIT', name: 'Take-profit', spoken: 'Take profit price' },
  'stop-loss': { label: 'STOP LOSS', name: 'Stop-loss', spoken: 'Stop loss price' },
} as const;

const PRICE_KEY: Readonly<Record<TriggerKind, keyof AutoClosePrices>> = {
  'take-profit': 'takeProfit',
  'stop-loss': 'stopLoss',
};

const NO_ERRORS: Readonly<Record<TriggerKind, string | null>> = { 'stop-loss': null, 'take-profit': null };

/**
 * The auto-close page: a take-profit price, a stop-loss price, either or both, typed on the same keypad
 * as the collateral so the ticket never raises the system keyboard.
 *
 * Checked with `validateTriggerPrice`, the function the order builder itself runs, so a price this page
 * accepts is one review will accept too — against the mark as it stands now. The mark keeps moving after
 * the page closes, which is why review checks again rather than trusting this.
 *
 * The keypad takes as many decimals as the market's tick has, and no more: a price finer than the tick
 * could never be a multiple of it.
 *
 * Like the leverage page, nothing changes on the ticket until the primary action is pressed.
 */
export function AutoClosePage({
  active,
  initial,
  mark,
  markText,
  onApply,
  onBack,
  side,
  tickSize,
}: {
  /** Whether auto close is on for the ticket now, which is what makes "turn off" meaningful. */
  readonly active: boolean;
  readonly initial: AutoClosePrices;
  readonly mark: Amount;
  readonly markText: string;
  readonly onApply: (next: AutoClosePrices) => void;
  readonly onBack: () => void;
  readonly side: PacificaOrderSide;
  readonly tickSize: string;
}) {
  const [prices, setPrices] = useState(initial);
  const [focus, setFocus] = useState<TriggerKind>('take-profit');
  const [errors, setErrors] = useState(NO_ERRORS);
  const [rejected, setRejected] = useState({ kind: focus, count: 0 });
  const decimals = stepDecimals(tickSize);
  const hasAny = prices.takeProfit.length > 0 || prices.stopLoss.length > 0;

  const edit = (next: string) => {
    setPrices((current) => ({ ...current, [PRICE_KEY[focus]]: next }));
    setErrors((current) => ({ ...current, [focus]: null }));
  };

  const pressKey = (key: KeypadKey) => {
    const current = prices[PRICE_KEY[focus]];
    const next = applyKeypadKey(current, key, decimals);
    if (next === current) {
      setRejected((last) => ({ count: last.count + 1, kind: focus }));
      return;
    }
    edit(next);
  };

  const check = (kind: TriggerKind): string | null => {
    const value = entryAmount(prices[PRICE_KEY[kind]]);
    if (value.length === 0) return null;
    try {
      validateTriggerPrice(value, FIELDS[kind].name, side, kind, mark.baseUnits, tickSize, mark.decimals);
      return null;
    } catch (cause) {
      return cause instanceof PacificaOrderValidationError ? cause.message : 'Enter a valid price.';
    }
  };

  const apply = () => {
    const next = { 'stop-loss': check('stop-loss'), 'take-profit': check('take-profit') };
    if (next['take-profit'] !== null || next['stop-loss'] !== null) {
      setErrors(next);
      setFocus(next['take-profit'] !== null ? 'take-profit' : 'stop-loss');
      return;
    }
    onApply({ stopLoss: entryAmount(prices.stopLoss), takeProfit: entryAmount(prices.takeProfit) });
  };

  const field = (kind: TriggerKind) => {
    const entry = prices[PRICE_KEY[kind]];
    return (
      <TriggerPriceField
        active={focus === kind}
        distance={markDistanceText(entryAmount(entry), mark)}
        entry={entry}
        error={errors[kind]}
        hint={triggerSideOfMark(kind, side) === 'above' ? 'Above mark' : 'Below mark'}
        label={FIELDS[kind].label}
        onPress={() => setFocus(kind)}
        rejectSignal={rejected.kind === kind ? rejected.count : 0}
        spokenLabel={FIELDS[kind].spoken}
      />
    );
  };

  return (
    <TicketPageLayout
      accessory={hasAny ? (
        <PressableScale
          accessibilityLabel="Clear take profit and stop loss"
          accessibilityRole="button"
          hitSlop={8}
          onPress={() => {
            setPrices({ stopLoss: '', takeProfit: '' });
            setErrors(NO_ERRORS);
            setFocus('take-profit');
          }}
          style={styles.clear}
        >
          <Text style={styles.clearLabel}>Clear</Text>
        </PressableScale>
      ) : null}
      footer={(
        <>
          <AmountKeypad onClear={() => edit('')} onKey={pressKey} />
          <ActionButton
            disabled={!hasAny && !active}
            label={!hasAny && active ? 'Turn off auto close' : 'Set auto close'}
            onPress={apply}
            size="large"
            tone="accent"
          />
        </>
      )}
      onBack={onBack}
      title="Auto close"
    >
      <TicketFigure label="Mark price" screenReaderLabel="Live mark price" value={markText} />
      {field('take-profit')}
      {field('stop-loss')}
      {/* Careful not to promise more than the order does: each price closes the position when it is
          reached, and neither is a guaranteed fill at that price. */}
      <Text style={styles.note}>Each closes the position when price reaches it. Neither is a guaranteed fill.</Text>
    </TicketPageLayout>
  );
}

const styles = StyleSheet.create({
  clear: { minHeight: 36, justifyContent: 'center', paddingHorizontal: spacing.xxs },
  clearLabel: { ...typography.label, color: colors.accentSoft },
  note: { ...typography.caption, color: colors.textMuted },
});
