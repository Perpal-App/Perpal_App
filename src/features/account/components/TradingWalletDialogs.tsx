import { StyleSheet, Text, View } from 'react-native';

import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { colors, spacing, typography } from '@/theme/tokens';
import type { TradingSessionRecovery } from '@/wallet/trading/TradingSessionProvider';
import type { TradingWalletRotationPlan } from '@/wallet/trading/rotationSafety';

export function TradingWalletRecoveryDialog({
  error,
  loading,
  onCancel,
  onConfirm,
  recovery,
  visible,
}: {
  readonly error: string | null;
  readonly loading: boolean;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
  readonly recovery: TradingSessionRecovery | null;
  readonly visible: boolean;
}) {
  if (recovery === null) return null;
  return (
    <ConfirmDialog
      confirmLabel="Verify and recover"
      confirmLoading={loading}
      onCancel={onCancel}
      onConfirm={onConfirm}
      title="Review private-wallet recovery"
      visible={visible}
    >
      <View style={styles.content}>
        <Text style={styles.message}>
          Sign a no-transaction message to verify your public wallet. Perpal first restores the
          recorded generation from its saved root when possible.
        </Text>
        <ReviewRow label="Reason" value={recovery.reason === 'mismatch' ? 'Identity mismatch' : 'Version upgrade'} />
        <ReviewRow label="Recorded" value={shortAddress(recovery.recorded.address)} />
        <ReviewRow label="Proposed" value={shortAddress(recovery.derived.address)} />
        <Text style={styles.notice}>
          A proposed identity is adopted only if the recorded wallet, Pacifica account, and every
          pending operation are confirmed empty. Otherwise the recorded identity is preserved.
        </Text>
        {error === null ? null : <Text style={styles.error}>{error}</Text>}
      </View>
    </ConfirmDialog>
  );
}

export function TradingWalletRotationDialog({
  loading,
  onCancel,
  onConfirm,
  plan,
}: {
  readonly loading: boolean;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
  readonly plan: TradingWalletRotationPlan | null;
}) {
  if (plan === null) return null;
  return (
    <ConfirmDialog
      confirmLabel="Confirm rotation"
      confirmLoading={loading}
      onCancel={onCancel}
      onConfirm={onConfirm}
      title="Review private-wallet rotation"
      visible
    >
      <View style={styles.content}>
        <Text style={styles.message}>
          Each token account is migrated and checkpointed before the final SOL sweep. The new
          identity activates only after the old wallet is empty.
        </Text>
        <ReviewRow label="Destination" value={shortAddress(plan.nextWalletAddress)} />
        <ReviewRow label="Token accounts" value={String(plan.tokenAccountCount)} />
        <ReviewRow label="Token mints" value={String(plan.tokenMintCount)} />
        <ReviewRow label="Estimated fees" value={`${formatSol(plan.estimatedFeeLamports)} SOL`} />
        <ReviewRow label="New account rent" value={`${formatSol(plan.destinationRentLamports)} SOL`} />
        <ReviewRow label="Recoverable rent" value={`${formatSol(plan.recoverableRentLamports)} SOL`} />
        <Text style={styles.notice}>
          Open positions, orders, provider collateral, withdrawals, and private funding block
          rotation until they are fully settled.
        </Text>
      </View>
    </ConfirmDialog>
  );
}

function ReviewRow({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text selectable style={styles.value}>{value}</Text>
    </View>
  );
}

function shortAddress(value: string): string {
  return `${value.slice(0, 6)}…${value.slice(-6)}`;
}

function formatSol(lamports: bigint): string {
  const whole = lamports / 1_000_000_000n;
  const fraction = (lamports % 1_000_000_000n).toString().padStart(9, '0').replace(/0+$/u, '');
  return fraction.length === 0 ? whole.toString() : `${whole}.${fraction}`;
}

const styles = StyleSheet.create({
  content: { gap: spacing.sm },
  message: { ...typography.bodyCompact, color: colors.textSecondary },
  notice: { ...typography.bodyCompact, color: colors.textMuted },
  error: { ...typography.bodyCompact, color: colors.negative },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  label: { ...typography.bodyCompact, flex: 1, color: colors.textMuted },
  value: { ...typography.label, flexShrink: 1, color: colors.textPrimary, textAlign: 'right' },
});
