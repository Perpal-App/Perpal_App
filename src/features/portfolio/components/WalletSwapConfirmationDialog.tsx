import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { StatusRow } from '@/components/ui/StatusRow';
import { colors, radii, spacing, typography } from '@/theme/tokens';

export type WalletSwapConfirmationDialogProps = {
  readonly estimatedEndingSol?: string | null;
  readonly expiresAt: string;
  readonly fee: string;
  readonly loading?: boolean;
  readonly maxNotice?: string | null;
  readonly minimumReceive: string;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
  readonly persistentRent?: string | null;
  readonly slippage: string;
  readonly spend: string;
  readonly temporaryRent?: string | null;
  readonly temporaryRentRefundNote?: string | null;
  readonly title: string;
  readonly visible: boolean;
  readonly wallet: string;
};

/** A financial review surface that knows presentation, not swap-plan implementation details. */
export function WalletSwapConfirmationDialog({
  estimatedEndingSol,
  expiresAt,
  fee,
  loading = false,
  maxNotice,
  minimumReceive,
  onCancel,
  onConfirm,
  persistentRent,
  slippage,
  spend,
  temporaryRent,
  temporaryRentRefundNote,
  title,
  visible,
  wallet,
}: WalletSwapConfirmationDialogProps) {
  return (
    <ConfirmDialog
      confirmLabel="Confirm and sign"
      confirmLoading={loading}
      onCancel={onCancel}
      onConfirm={onConfirm}
      title={title}
      visible={visible}
    >
      <ScrollView
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="never"
        showsVerticalScrollIndicator={false}
        style={styles.scroll}
      >
        <View
          accessible
          accessibilityLabel={`Spend ${spend}. Receive at least ${minimumReceive}.`}
          style={styles.exchange}
        >
          <Amount label="You pay" value={spend} />
          <View accessibilityElementsHidden style={styles.divider} />
          <Amount label="Minimum received" value={minimumReceive} />
        </View>

        <View style={styles.details}>
          <StatusRow label="Wallet" selectable value={wallet} />
          <StatusRow label="Network fee" selectable singleLine value={fee} />
          {persistentRent === null || persistentRent === undefined ? null : (
            <StatusRow label="Token account rent" selectable singleLine value={persistentRent} />
          )}
          {temporaryRent === null || temporaryRent === undefined ? null : (
            <StatusRow label="Temporary rent" selectable singleLine value={temporaryRent} />
          )}
          <StatusRow label="Maximum slippage" selectable singleLine value={slippage} />
          <StatusRow label="Quote expires" selectable singleLine value={expiresAt} />
          {estimatedEndingSol === null || estimatedEndingSol === undefined ? null : (
            <StatusRow label="Estimated SOL after" selectable singleLine value={estimatedEndingSol} />
          )}
        </View>

        {temporaryRentRefundNote === null || temporaryRentRefundNote === undefined ? null : (
          <Text selectable style={styles.note}>{temporaryRentRefundNote}</Text>
        )}
        {maxNotice === null || maxNotice === undefined ? null : (
          <View accessible accessibilityRole="alert" style={styles.notice}>
            <Text selectable style={styles.noticeText}>{maxNotice}</Text>
          </View>
        )}
      </ScrollView>
    </ConfirmDialog>
  );
}

function Amount({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <View style={styles.amount}>
      <Text style={styles.amountLabel}>{label}</Text>
      <Text selectable style={styles.amountValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { flexShrink: 1 },
  content: { gap: spacing.md },
  exchange: {
    gap: spacing.sm,
    padding: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
    borderRadius: radii.sm,
    borderCurve: 'continuous',
    backgroundColor: colors.surface,
  },
  amount: { gap: spacing.xxs },
  amountLabel: { ...typography.caption, color: colors.textMuted },
  amountValue: {
    ...typography.heading,
    color: colors.textPrimary,
    fontVariant: ['tabular-nums'],
  },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  details: { gap: spacing.sm },
  note: { ...typography.caption, color: colors.textMuted },
  notice: {
    padding: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
    borderRadius: radii.sm,
    borderCurve: 'continuous',
    backgroundColor: colors.surface,
  },
  noticeText: { ...typography.bodyCompact, color: colors.textSecondary },
});
