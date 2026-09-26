import { Pressable, StyleSheet, Text, View } from 'react-native';

import { entryText } from '@/features/trade/components/orderTicket/keypadEntry';
import { KeypadAmount } from '@/features/trade/components/orderTicket/KeypadAmount';
import { TicketPanel } from '@/features/trade/components/orderTicket/TicketPanel';
import { colors, spacing, typography } from '@/theme/tokens';

/**
 * One auto-close price: what it is, which side of the mark it belongs on, and how far from it it sits.
 *
 * The keypad below writes into whichever field is active, and the active one says so on its rim. Tap a
 * field to make it the one being typed into. An error replaces nothing and colours nothing on its own:
 * it is a line of text under the field, so the problem is never carried by colour alone.
 */
export function TriggerPriceField({
  active,
  distance,
  entry,
  error,
  hint,
  label,
  onPress,
  rejectSignal,
  spokenLabel,
}: {
  readonly active: boolean;
  /** Signed distance from the mark, e.g. `+4.20%`, or `null` while there is no usable price. */
  readonly distance: string | null;
  readonly entry: string;
  readonly error: string | null;
  /** Which side of the mark the price has to be on, e.g. `Above mark`. */
  readonly hint: string;
  readonly label: string;
  readonly onPress: () => void;
  readonly rejectSignal: number;
  readonly spokenLabel: string;
}) {
  const value = entry.length === 0 ? 'not set' : `$${entryText(entry)}`;

  return (
    <View style={styles.field}>
      <Pressable
        accessibilityHint={`${hint}. The keypad types into the selected price.`}
        accessibilityLabel={`${spokenLabel}, ${value}${distance === null ? '' : `, ${distance} from mark`}`}
        accessibilityRole="button"
        accessibilityState={{ selected: active }}
        onPress={onPress}
      >
        <TicketPanel style={[styles.card, active && styles.cardActive, error !== null && styles.cardInvalid]}>
          <View style={styles.head}>
            <Text style={styles.eyebrow}>{label}</Text>
            <Text style={styles.hint}>{hint}</Text>
          </View>
          <View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={styles.row}
          >
            <KeypadAmount accessibilityLabel={value} entry={entry} rejectSignal={rejectSignal} size="field" />
            <Text style={styles.distance}>{distance ?? 'Optional'}</Text>
          </View>
        </TicketPanel>
      </Pressable>
      {error === null ? null : (
        <Text accessibilityLiveRegion="polite" accessibilityRole="alert" style={styles.error}>{error}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: spacing.xxs },
  card: { gap: spacing.xxs, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  // A full-weight rim rather than the hairline, in the one colour that means "this is the selected one".
  cardActive: { borderWidth: 1, borderColor: colors.accent },
  cardInvalid: { borderWidth: 1, borderColor: colors.negative },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  eyebrow: { ...typography.eyebrow, letterSpacing: 0.5, color: colors.textMuted },
  hint: { ...typography.caption, color: colors.textMuted },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  distance: { ...typography.caption, flexShrink: 0, color: colors.textSecondary },
  error: { ...typography.caption, color: colors.negative },
});
