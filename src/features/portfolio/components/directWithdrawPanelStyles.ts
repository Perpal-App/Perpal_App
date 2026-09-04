import { StyleSheet } from 'react-native';

import { colors, layout, radii, spacing, typography } from '@/theme/tokens';

export const directWithdrawPanelStyles = StyleSheet.create({
  panel: { gap: spacing.md },
  title: { ...typography.heading, color: colors.textPrimary },
  note: { ...typography.bodyCompact, color: colors.textSecondary },
  buttons: { flexDirection: 'row', gap: spacing.sm },
  button: { flex: 1 },
  amountRow: { flexDirection: 'row', alignItems: 'stretch', gap: spacing.xs },
  input: {
    minHeight: layout.minTouchTarget,
    paddingHorizontal: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
    borderRadius: radii.sm,
    color: colors.textPrimary,
    backgroundColor: colors.background,
    ...typography.bodyCompact,
  },
  amountInput: { flex: 1, minWidth: 0 },
  max: { minWidth: 64 },
});
