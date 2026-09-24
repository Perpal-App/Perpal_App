import { StyleSheet } from 'react-native';

import { colors, spacing, typography } from '@/theme/tokens';

export const pacificaOrderTicketStyles = StyleSheet.create({
  panel: { gap: spacing.xs, paddingVertical: spacing.xs },
  title: { ...typography.heading, color: colors.textPrimary },
  loading: { minHeight: 180, justifyContent: 'center', gap: spacing.sm },
  message: { ...typography.bodyCompact, color: colors.textSecondary },
  controls: { flexDirection: 'row', gap: spacing.xs },
  /** Takes the room left over in a `controls` row, for a pair where one side sizes to its label. */
  grow: { flex: 1 },
  /** One line under a heading, for a prerequisite the reader cannot be expected to already know. */
  note: { ...typography.caption, color: colors.textMuted },
  summary: { gap: spacing.xxs, paddingTop: spacing.xs },
  riskRows: {
    gap: spacing.xxs,
    paddingTop: spacing.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  success: { ...typography.bodyCompact, color: colors.positive },
  error: { ...typography.bodyCompact, color: colors.negative },
  validationError: { ...typography.caption, color: colors.negative },
});
