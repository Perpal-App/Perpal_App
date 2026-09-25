import { StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { PressableScale } from '@/components/ui/PressableScale';
import { SlideToConfirm } from '@/components/ui/SlideToConfirm';
import { WITHDRAW_RADIUS } from '@/features/portfolio/components/withdrawSheetStyles';
import { colors, radii, spacing, typography } from '@/theme/tokens';

export type WithdrawReviewRow = {
  readonly label: string;
  readonly value: string;
};

/** Matched to the sheet's own close control, so the two read as one pair of chrome. */
const BACK_SIZE = 36;
const BACK_GLYPH = 18;

/**
 * The last step before a withdrawal is signed, shown where the form was.
 *
 * In place rather than over the top, which is the substance of the change and not the presentation. The
 * platform alert this replaced covered the amount and destination the reader was being asked to approve,
 * and put its two words one thumb-width apart. Putting the review in the form's own place means the
 * figures stay in the column they were entered in.
 *
 * It is a step, not a card. It used to be a bordered panel one surface above the sheet, nested inside
 * the sheet's own rounded shell with the source selector still sitting above it — a box in a box, under
 * two controls whose decision had already been made. The frame was drawing a boundary around the only
 * thing on screen. Now the content sits directly on the sheet, the selectors above it are withdrawn for
 * the duration, and the sheet reads as having moved to a second step rather than as having grown a panel.
 *
 * Every number is its own row rather than a paragraph. A confirmation is read by scanning for the one
 * value that might be wrong, and a sentence makes the reader parse four facts to check one. The amount
 * leads at display size because it is the figure a mistake would be in; the fee and any rent follow at
 * row size, as costs to be aware of rather than the decision.
 *
 * Backing out is the arrow in the header, which is also the only way back — the full-width `Cancel`
 * button that used to sit under the slide is gone. Two stacked full-width controls at the foot of a
 * sheet make the reader distinguish between them by reading, and the lower of the two was the one the
 * thumb already rested on. An arrow in the top-left is where returning lives everywhere else, it cannot
 * be mistaken for the action, and it leaves the slide alone at the bottom as the only thing to reach for.
 */
export function WithdrawReviewStep({
  confirming,
  headline,
  note,
  onBack,
  onConfirm,
  rows,
  slideLabel,
  title,
  workingLabel,
}: {
  readonly confirming: boolean;
  /** The amount, set large. Pass it already formatted with its symbol. */
  readonly headline: string;
  /**
   * The one claim that cannot be a row, kept to a line or two.
   *
   * Anything with a label and a short fixed value belongs in `rows`, where it is scannable — this is for
   * a conditional, which has no value to put on the right. At `caption` size the column fits roughly 48
   * characters a line, and this note started as a 121-character paragraph that wrapped to three of them
   * under four rows, which is where a reader stops reading. Keep it under two.
   */
  readonly note: string;
  /** Returns to the form with the entered amount and destination intact. */
  readonly onBack: () => void;
  readonly onConfirm: () => void;
  readonly rows: readonly WithdrawReviewRow[];
  readonly slideLabel: string;
  readonly title: string;
  readonly workingLabel: string;
}) {
  return (
    <View accessibilityRole="summary" style={styles.step}>
      {/* The step's own heading, because the sheet's title and source selector are hidden while this
          is up. Locked during signing: the plan is being submitted, and a route back from a request
          already in flight would be a promise this cannot keep. */}
      <View style={styles.header}>
        <PressableScale
          accessibilityHint="Returns to the previous form"
          accessibilityLabel="Back"
          accessibilityRole="button"
          disabled={confirming}
          hitSlop={12}
          onPress={onBack}
          style={[styles.back, confirming && styles.backLocked]}
        >
          <BackIcon />
        </PressableScale>
        <Text accessibilityRole="header" numberOfLines={1} style={styles.title}>{title}</Text>
      </View>

      <View style={styles.facts}>
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
      </View>

      {/* Full width and last, with the step's widest gap above it. Nothing follows it, so the bottom of
          the sheet is the action and the reader's thumb has one target there. */}
      <SlideToConfirm
        confirming={confirming}
        label={slideLabel}
        onConfirm={onConfirm}
        radius={WITHDRAW_RADIUS}
        workingLabel={workingLabel}
      />
    </View>
  );
}

/** Drawn rather than pulled from an icon font, like every other glyph in this sheet. */
function BackIcon() {
  return (
    <Svg height={BACK_GLYPH} viewBox="0 0 24 24" width={BACK_GLYPH}>
      <Path
        d="M14.5 5 7.5 12l7 7"
        fill="none"
        stroke={colors.textPrimary}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
      />
    </Svg>
  );
}

const styles = StyleSheet.create({
  // No frame, no fill, no padding of its own: the sheet's surface is the surface, and the sheet's
  // content inset is the margin. The three groups are separated by space alone.
  step: { gap: spacing.lg },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  back: {
    width: BACK_SIZE,
    height: BACK_SIZE,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceElevated,
  },
  backLocked: { opacity: 0.4 },
  title: { ...typography.heading, flexShrink: 1, minWidth: 0, color: colors.textPrimary },
  // The facts as one block with a tighter gap than the step's, so the amount, the rows and the claim
  // read as a single thing being approved rather than three sections.
  facts: { gap: spacing.sm },
  headline: {
    ...typography.title,
    color: colors.textPrimary,
    fontVariant: ['tabular-nums'],
  },
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
});
