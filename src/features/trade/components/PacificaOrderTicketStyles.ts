import { StyleSheet } from 'react-native';

import { colors, spacing, typography } from '@/theme/tokens';

export const pacificaOrderTicketStyles = StyleSheet.create({
  /**
   * The ticket's outer rhythm — the gap *between* groups of controls.
   *
   * It was `xs`, the same 8pt used inside a group, which meant the sheet had no rhythm at all: the
   * margin row, the order type, the mark, the side pair, the amount, the slider, the presets, two
   * switches, the action and the figures under it all sat at one interval, so a reader scanning it got
   * no help telling which controls answer the same question. One step up here against `group` below is
   * the whole of the hierarchy, and it costs no borders and no cards to say it.
   */
  panel: { gap: spacing.sm, paddingVertical: spacing.xs },
  /** A run of controls that settle one question, held tighter than the gap to the next run. */
  group: { gap: spacing.xs },
  title: { ...typography.heading, color: colors.textPrimary },
  loading: { minHeight: 180, justifyContent: 'center', gap: spacing.sm },
  message: { ...typography.bodyCompact, color: colors.textSecondary },
  controls: { flexDirection: 'row', gap: spacing.xs },
  /** Takes the room left over in a `controls` row, for a pair where one side sizes to its label. */
  grow: { flex: 1 },
  /** One line under a heading, for a prerequisite the reader cannot be expected to already know. */
  note: { ...typography.caption, color: colors.textMuted },
  // No `paddingTop`: it was here to buy separation the panel's old 8pt interval did not give, and with
  // `panel` now at `sm` it would stack on top of that and read as a gap nobody asked for.
  summary: { gap: spacing.xxs },
  riskRows: {
    gap: spacing.xxs,
    paddingTop: spacing.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  // No `success` entry. There was one, `bodyCompact` in `positive`, with no consumer anywhere — a
  // leftover from when a placed order was meant to be a line of green text in the form. It is a card of
  // its own now (`PacificaOrderPlacedCard`), which owns its ink, so the dead token is gone rather than
  // sitting here looking like the thing that styles the confirmation.
  error: { ...typography.bodyCompact, color: colors.negative },
  validationError: { ...typography.caption, color: colors.negative },
});
