import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import {
  amountFromBaseUnits,
  formatAmount,
  type TokenDecimals,
} from '@/domain/money/amount';
import {
  creditedUmbraAmount,
  estimateUmbraCreateFee,
} from '@/integrations/umbra/privateFundingFees';
import { colors, radii, spacing, typography } from '@/theme/tokens';

export type PrivateFundingConfirmation = {
  readonly amountBaseUnits: bigint;
  readonly decimals: TokenDecimals;
  readonly destination: 'private' | 'pacifica';
  readonly estimatedNetworkFeeLamports: bigint;
  readonly feeReserveLamports: bigint;
  readonly hasSubmittedTransaction: boolean;
  readonly mode: 'start' | 'resume';
  readonly requiredSolLamports: bigint;
  readonly symbol: 'USDC' | 'USDT';
  readonly temporaryRentLamports: bigint;
};

export function PrivateFundingConfirmationModal({
  confirmation,
  onCancel,
  onConfirm,
}: {
  readonly confirmation: PrivateFundingConfirmation | null;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}) {
  if (confirmation === null) {
    return null;
  }

  const amount = formatAmount(amountFromBaseUnits(
    confirmation.amountBaseUnits,
    confirmation.decimals,
  ));
  const reserve = formatAmount(amountFromBaseUnits(
    confirmation.feeReserveLamports,
    9,
  ));
  const collateralFee = formatAmount(amountFromBaseUnits(
    estimateUmbraCreateFee(confirmation.amountBaseUnits),
    confirmation.decimals,
  ));
  const creditedCollateral = formatAmount(amountFromBaseUnits(
    creditedUmbraAmount(confirmation.amountBaseUnits),
    confirmation.decimals,
  ));
  const reserveFee = formatAmount(amountFromBaseUnits(
    estimateUmbraCreateFee(confirmation.feeReserveLamports),
    9,
  ));
  const networkFee = sol(confirmation.estimatedNetworkFeeLamports);
  const temporaryRent = sol(confirmation.temporaryRentLamports);
  const requiredSol = sol(confirmation.requiredSolLamports);
  return (
    <Modal
      animationType="fade"
      onRequestClose={onCancel}
      transparent
      visible
    >
      <View style={styles.backdrop}>
        <Pressable
          accessibilityLabel="Cancel private funding"
          accessibilityRole="button"
          onPress={onCancel}
          style={StyleSheet.absoluteFill}
        />
        <View accessibilityViewIsModal style={styles.card}>
          <Text accessibilityRole="header" style={styles.title}>
            {confirmation.mode === 'resume'
              ? 'Resume private funding'
              : 'Confirm private funding'}
          </Text>
          <ConfirmationRow
            label="Collateral"
            value={`${amount} ${confirmation.symbol}`}
          />
          <ConfirmationRow label="Trading fee reserve" value={`${reserve} SOL`} />
          <ConfirmationRow
            label="Route"
            value={confirmation.destination === 'pacifica'
              ? 'Public → Umbra → Pacifica'
              : 'Public → Umbra → private wallet'}
          />
          <ConfirmationRow
            label="Estimated Umbra fee"
            value={`${collateralFee} ${confirmation.symbol} + ${reserveFee} SOL`}
          />
          {confirmation.destination === 'pacifica' ? (
            <>
              <ConfirmationRow
                label="Estimated Pacifica credit"
                value={`${creditedCollateral} ${confirmation.symbol}`}
              />
              <ConfirmationRow label="Minimum Pacifica credit" value="10 USDC" />
            </>
          ) : null}
          <ConfirmationRow
            label="Estimated network fees"
            value={`${networkFee} SOL`}
          />
          <ConfirmationRow label="Temporary account rent" value={`${temporaryRent} SOL`} />
          <ConfirmationRow label="Public SOL required" value={`${requiredSol} SOL`} />
          {confirmation.mode === 'resume' ? (
            <ConfirmationRow
              label="Saved transaction state"
              value={confirmation.hasSubmittedTransaction
                ? 'Reconcile before resubmitting'
                : 'No transaction submitted'}
            />
          ) : null}
          <Text style={styles.note}>
            Each transaction is shown for approval. Confirmed stages are saved so
            recovery never repeats completed work.
          </Text>
          <View style={styles.actions}>
            <Button label="Cancel" onPress={onCancel} variant="secondary" />
            <Button
              label={confirmation.mode === 'resume' ? 'Resume' : 'Continue'}
              onPress={onConfirm}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

function ConfirmationRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

function sol(lamports: bigint): string {
  return formatAmount(amountFromBaseUnits(lamports, 9));
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'center',
    padding: spacing.lg,
    backgroundColor: 'rgba(0, 0, 0, 0.76)',
  },
  card: {
    gap: spacing.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
  },
  title: { ...typography.heading, color: colors.textPrimary },
  row: {
    gap: spacing.md,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  label: { ...typography.bodyCompact, color: colors.textSecondary, flex: 1 },
  value: {
    ...typography.bodyCompact,
    color: colors.textPrimary,
    flex: 1.5,
    textAlign: 'right',
  },
  note: { ...typography.bodyCompact, color: colors.textSecondary },
  actions: { gap: spacing.sm },
});
