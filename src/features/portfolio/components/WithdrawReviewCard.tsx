import { StyleSheet, Text, View } from 'react-native';

import { ActionButton } from '@/components/ui/ActionButton';
import { SlideToConfirm } from '@/components/ui/SlideToConfirm';
import { WITHDRAW_RADIUS } from '@/features/portfolio/components/withdrawSheetStyles';
import { colors, radii, spacing, typography } from '@/theme/tokens';

export type WithdrawReviewRow = {
  readonly label: string;
  readonly value: string;
};

/**
 * The last step before a withdrawal is signed, shown where the form was.
 *
 * In place rather than over the top, which is the substance of the change and not the presentation. The
 * platform alert this replaced covered the sheet it was launched from, so the amount and destination the
 * reader was being asked to approve were behind the thing asking — and the two words it offered were a
 * tap apart, one of them reachable by the same thumb position that had just pressed Review. Putting the
 * review in the form's own place means the figures stay in the column they were entered in, and nothing
 * else on the sheet moves.
 *
 * Every number is its own row rather than a paragraph. A confirmation is read by scanning for the one
 * value that might be wrong, and a sentence makes the reader parse four facts to check one.
 *
 * The amount leads and is set at display size, because it is the figure a mistake would be in. The
 * network fee and any account rent follow at row size: they are costs to be aware of, not the decision.
 *
 * Confirming is a slide, not a button — see `SlideToConfirm`. Cancel stays an ordinary button, because
 * backing out should be the easy one.
 */
export function WithdrawReviewCard({
  cancelLabel = 'Cancel',
  confirming,
  headline,
  note,
  onCancel,
  onConfirm,
  rows,
  slideLabel,
  title,
  workingLabel,
}: {
  readonly cancelLabel?: string;
  readonly confirming: boolean;
  /** The amount, set large. Pass it already formatted with its symbol. */
  readonly headline: string;
  /** The one claim that needs a sentence — what the route does or does not hide. */
  readonly note: string;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
  readonly rows: readonly WithdrawReviewRow[];
  readonly slideLabel: string;
  readonly title: string;
  readonly workingLabel: string;
}) {
  return (
    <View accessibilityRole="summary" style={styles.card}>
      <Text style={styles.eyebrow}>{title}</Text>
      <Text selectable style={styles.headline}>{headline}</Text>

      <View style={styles.rows}>
        {rows.map((row) => (
          <View key={row.label} style={styles.row}>
            <Text style={styles.label}>{row.label}</Text>
            {/* `selectable`, so a destination address can be copied out and checked against
                wherever the reader keeps it. */}
            <Text numberOfLines={1} selectable style={styles.value}>{row.value}</Text>
          </View>
        ))}
      </View>

      <Text style={styles.note}>{note}</Text>

      <SlideToConfirm
        confirming={confirming}
        label={slideLabel}
        onConfirm={onConfirm}
        radius={WITHDRAW_RADIUS}
        workingLabel={workingLabel}
      />

      <ActionButton
        disabled={confirming}
        label={cancelLabel}
        onPress={onCancel}
        radius={WITHDRAW_RADIUS}
        style={styles.cancel}
        tone="neutral"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  // A panel inside the sheet rather than a floating card: one step up from the sheet's own surface, the
  // sheet's interior corner, and a hairline. It occupies the space the form gave up, so it is the same
  // object in the same place showing a later stage of the same task.
  card: {
    gap: spacing.sm,
    padding: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: WITHDRAW_RADIUS,
    borderCurve: 'continuous',
    backgroundColor: colors.surface,
  },
  eyebrow: { ...typography.eyebrow, color: colors.textMuted },
  headline: {
    ...typography.title,
    color: colors.textPrimary,
    fontVariant: ['tabular-nums'],
  },
  // Its own group with a tighter gap than the card's, so the facts read as one block between the amount
  // above them and the claim below.
  rows: { gap: spacing.xxs, paddingVertical: spacing.xxs },
  row: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  label: { ...typography.bodyCompact, flexShrink: 0, color: colors.textMuted },
  value: {
    ...typography.label,
    flexShrink: 1,
    color: colors.textPrimary,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  note: { ...typography.caption, color: colors.textSecondary },
  cancel: { width: '100%', borderRadius: radii.md },
});
