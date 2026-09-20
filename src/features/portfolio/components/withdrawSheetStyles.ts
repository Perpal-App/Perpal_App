import { StyleSheet } from 'react-native';

import { colors, layout, radii, spacing, typography } from '@/theme/tokens';

/**
 * Corner for everything inside the withdraw sheet.
 *
 * The sheet's own shell is `radii.panel` (32) and every control in it was `radii.sm` (10), which is
 * most of why the interior read as hard next to its container — a 22-point jump with nothing between
 * them. `radii.md` halves that gap, and at the 42pt control height it is 38% of the height: clearly
 * rounded without tipping into a pill, which at this width would read as a tag rather than a button.
 *
 * Applied here rather than on `ActionButton`'s own default, which 12 files across the app depend on.
 */
export const WITHDRAW_RADIUS = radii.md;

/**
 * Height of the primary action, above the 42 every selector in the sheet takes.
 *
 * The CTA was the same object as the six selectors above it at the same size, same radius and — when
 * a selector is chosen — the same accent fill. Nothing but position said which one submitted. Ten
 * points of extra height is enough to separate them without a second colour.
 */
export const WITHDRAW_CTA_HEIGHT = 52;

/**
 * One set of styles for all four withdraw panels.
 *
 * There were four independent copies of the heading / note / button-row block — one per panel — plus
 * two copies of the input. They had already drifted: one panel spaced its heading with a hardcoded
 * `gap: 2` where another used `spacing.xs`, and `directWithdrawPanelStyles` existed but was imported
 * by exactly one of the four files that duplicated it.
 */
export const withdrawSheetStyles = StyleSheet.create({
  /** The sheet's one title. Sub-sections are labelled, not titled — see `WithdrawChoice`. */
  title: { ...typography.heading, color: colors.textPrimary },
  panel: { gap: spacing.md },
  /** Wider than the gap inside a field, so the fields read as separate decisions. */
  stack: { gap: spacing.lg },
  amountRow: { flexDirection: 'row', alignItems: 'stretch', gap: spacing.xs },
  // A hairline rim rather than a full point: an input is a recess, and a full-point edge belongs to a
  // raised surface. Height matched to the controls beside it so the row reads evenly.
  input: {
    minHeight: layout.minTouchTarget,
    paddingHorizontal: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
    borderRadius: WITHDRAW_RADIUS,
    borderCurve: 'continuous',
    color: colors.textPrimary,
    backgroundColor: colors.background,
    ...typography.bodyCompact,
  },
  amountInput: { flex: 1, minWidth: 0 },
  max: { minWidth: 64 },
  cta: { minHeight: WITHDRAW_CTA_HEIGHT },
  /**
   * For the one sentence a panel may still need: an empty state, where the form has nothing to put in
   * it and no other way to say so. Not for describing what a button does.
   */
  note: { ...typography.bodyCompact, color: colors.textSecondary },
});
