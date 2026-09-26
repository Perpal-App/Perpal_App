import { StyleSheet, View } from 'react-native';

import { ActionButton } from '@/components/ui/ActionButton';
import type { PacificaOrderPhase } from '@/features/trade/hooks/usePacificaOrderFlow';
import type { PacificaOrderSide } from '@/integrations/perps/pacifica/pacificaOrder';
import { spacing } from '@/theme/tokens';

/** `ActionButton` always takes a handler; a disabled one never reaches it. */
const noop = () => undefined;

/**
 * The form's one action, and every state it can be in.
 *
 * Its label carries the reason it cannot be pressed — `Enter an amount`, `Minimum position $10` — so the
 * reader is told what the ticket needs at the exact spot they reach for. Review itself opens the review
 * page; nothing here signs anything.
 *
 * `negative` under `disabled` for a deposit that cannot be paid: blocked, not inviting. The accent is kept
 * for a deposit that can actually be made.
 */
export function TicketPrimaryAction({
  block,
  cannotFund,
  deposit,
  onRequestFunding,
  onReview,
  phase,
  recoveryPending,
  side,
}: {
  /** Why review is unavailable, as the button's label, or `null` when it is available. */
  readonly block: string | null;
  readonly cannotFund: boolean;
  readonly deposit: boolean;
  readonly onRequestFunding?: (() => void) | undefined;
  readonly onReview: () => void;
  readonly phase: PacificaOrderPhase;
  /** A deposit from an earlier session is still landing. */
  readonly recoveryPending: boolean;
  readonly side: PacificaOrderSide;
}) {
  if (deposit && recoveryPending) {
    return (
      <ActionButton
        disabled
        label={phase === 'indexing' ? 'Pacifica crediting funds' : 'Deposit confirming'}
        loading
        onPress={noop}
        size="large"
        tone="neutral"
      />
    );
  }

  if (cannotFund) {
    // The block and its remedy on one line. `Insufficient funds` takes the room and says what is wrong;
    // `Add funds` sizes to its own label and is the only thing here that can be pressed.
    return (
      <View style={styles.pair}>
        <ActionButton disabled label="Insufficient funds" onPress={noop} size="large" style={styles.grow} tone="negative" />
        {onRequestFunding === undefined ? null : (
          <ActionButton
            accessibilityHint="Opens the private funding flow"
            label="Add funds"
            onPress={onRequestFunding}
            size="large"
            tone="accent"
          />
        )}
      </View>
    );
  }

  return (
    <ActionButton
      disabled={block !== null}
      label={block ?? (deposit ? 'Review deposit' : `Review ${side}`)}
      loading={phase === 'preparing'}
      onPress={onReview}
      size="large"
      tone={deposit ? 'accent' : side === 'long' ? 'positive' : 'negative'}
    />
  );
}

const styles = StyleSheet.create({
  pair: { flexDirection: 'row', gap: spacing.sm },
  grow: { flex: 1 },
});
