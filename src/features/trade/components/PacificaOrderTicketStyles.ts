import { StyleSheet } from 'react-native';

import { colors, spacing, typography } from '@/theme/tokens';

export const pacificaOrderTicketStyles = StyleSheet.create({
  panel: { gap: spacing.xs, paddingVertical: spacing.xs },
  title: { ...typography.heading, color: colors.textPrimary },
  controls: { flexDirection: 'row', gap: spacing.xs },
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
