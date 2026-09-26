import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, View } from 'react-native';

import { UsdcMark } from '@/assets/svg/UsdcMark';
import { PressableScale } from '@/components/ui/PressableScale';
import { entryText } from '@/features/trade/components/orderTicket/keypadEntry';
import { KeypadAmount } from '@/features/trade/components/orderTicket/KeypadAmount';
import { TicketPanel } from '@/features/trade/components/orderTicket/TicketPanel';
import { showAppToast } from '@/storage/appToast';
import { colors, spacing, typography } from '@/theme/tokens';

const INFO_GLYPH = 14;
/** Brings the 14pt glyph's touch target up to the 44pt minimum without moving anything around it. */
const INFO_HIT_SLOP = 15;
const TOKEN_MARK = 22;

/**
 * What the info button says. Short enough for the toast's two lines, and specific to the form: the
 * trading form's figure is margin that sizes a position, the deposit form's is a transfer into the venue.
 */
const EXPLANATIONS = {
  Collateral: 'Collateral is the USDC you commit. Position size is collateral × leverage.',
  Deposit: "Deposits move USDC from your private balance into Pacifica's vault.",
} as const;

/**
 * How much of the reader's money this order commits: the ticket's headline figure.
 *
 * Three lines, read top to bottom as one statement. What the figure is, with a way to ask; the figure,
 * beside the token it is paid in; and the same amount in that token, beside what there is to commit.
 *
 * Display-only — the keypad under it is the input, so nothing ever covers it and the card never moves.
 * `Available balance` is shown to the cent and truncated, never rounded up, and the presets truncate the
 * same way, so `Max` and the balance printed here always agree. It turns to the loss colour when the entry
 * is over it, as a second signal beside the action's own label, which is what says so in words.
 */
export function CollateralCard({
  available,
  entry,
  label,
  over,
  rejectSignal,
}: {
  /** Formatted to the cent, e.g. `$2,534.41`, or `--` while a balance it depends on is still loading. */
  readonly available: string;
  readonly entry: string;
  readonly label: keyof typeof EXPLANATIONS;
  /** The entry is more than is available. */
  readonly over: boolean;
  readonly rejectSignal: number;
}) {
  const amount = entry.length === 0 ? '0' : entryText(entry);

  return (
    <TicketPanel style={styles.card}>
      <View style={styles.head}>
        <Text style={styles.eyebrow}>{label.toUpperCase()}</Text>
        <PressableScale
          accessibilityHint="Explains this amount"
          accessibilityLabel={`About ${label.toLowerCase()}`}
          accessibilityRole="button"
          hitSlop={INFO_HIT_SLOP}
          onPress={() => showAppToast({ message: EXPLANATIONS[label], outcome: 'info' })}
        >
          <Ionicons color={colors.textMuted} name="information-circle" size={INFO_GLYPH} />
        </PressableScale>
      </View>

      <View style={styles.amountRow}>
        <KeypadAmount
          accessibilityLabel={`${label} amount, ${entry.length === 0 ? 'none entered' : `$${amount}`}`}
          entry={entry}
          rejectSignal={rejectSignal}
          size="hero"
        />
        {/* Decorative: the amount line under it already says the token in words. */}
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.token}>
          <UsdcMark size={TOKEN_MARK} />
          <Text style={styles.tokenLabel}>USDC</Text>
        </View>
      </View>

      <View style={styles.foot}>
        <Text numberOfLines={1} style={styles.caption}>{`${amount} USDC`}</Text>
        <Text
          accessibilityLabel={`Available balance ${available}`}
          numberOfLines={1}
          style={[styles.caption, styles.available]}
        >
          {'Available balance: '}
          <Text style={[styles.balance, over && styles.balanceOver]}>{available}</Text>
        </Text>
      </View>
    </TicketPanel>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.xxs, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.xxs },
  eyebrow: { ...typography.eyebrow, letterSpacing: 0.5, color: colors.textMuted },
  amountRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  token: { flexDirection: 'row', alignItems: 'center', flexShrink: 0, gap: spacing.xs },
  tokenLabel: { ...typography.label, color: colors.textPrimary },
  // The amount in the token on the left and the balance on the right, both on the caption line: the
  // figure above is the one being read, and these are what it is measured against.
  foot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  caption: { ...typography.caption, color: colors.textMuted },
  // The side that gives way on a narrow screen: the entered amount on the left is the one being checked.
  available: { flexShrink: 1, textAlign: 'right' },
  balance: { color: colors.textSecondary },
  balanceOver: { color: colors.negative },
});
