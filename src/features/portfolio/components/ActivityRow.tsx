import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, Text, View } from 'react-native';

import { SkeletonText } from '@/components/feedback/Skeleton';
import type { ActivityItem } from '@/features/portfolio/components/activityItems';
import {
  activityAmountColor,
  activityDirection,
} from '@/features/portfolio/components/activityTone';
import { colors, gradients, interfaceType, radii, spacing } from '@/theme/tokens';

/**
 * How much of the row the amount may claim.
 *
 * Token amounts here are unrounded — `0.009271901 SOL` is a real row — and the amount is the thing
 * this column exists for, so it never shrinks or wraps; the title wraps instead. The cap stops a
 * pathological figure from taking the whole row and leaving no title at all.
 */
const AMOUNT_MAX_WIDTH = '54%';

const MAX_TEXT_SCALE = 1.3;
const MINUS = '\u2212';

const DATE_FORMATTER = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  month: 'short',
});

/**
 * One event in the history, in words and figures alone: what happened and its particulars on the left,
 * what it was worth and when on the right.
 *
 * No mark. The glyph that opened each row said the event's direction and nothing the words did not, and
 * a column of them down the feed was what made it read as generated rather than designed. The direction
 * lives in the amount's colour instead — green for value arriving, red for value leaving — and a failed
 * event's title turns red as well, so a failure is stated in its words and its tone rather than by a
 * shape. An event that moved nothing stays white.
 *
 * Two lines on each side, on matched leading, so the amount sits on the title's line and the time on
 * the particulars' line, and the times run down the feed as one column. Set in the interface face with
 * the portfolio around it: a semibold name over a regular muted line, a semibold tabular amount over a
 * regular muted time, and a true minus on every loss so the signs line up with the digits.
 */
export function ActivityRow({ item }: { readonly item: ActivityItem }) {
  const direction = activityDirection(item);
  const value = item.value === null ? null : item.value.replace(/^-/u, MINUS);
  const time = DATE_FORMATTER.format(new Date(item.createdAtMs));
  const failed = item.outcome === 'error';

  return (
    <LinearGradient
      accessibilityLabel={[item.title, value, item.detail, time].filter((part) => part !== null).join(', ')}
      accessible
      colors={gradients.surfaceRaise.colors}
      end={{ x: 0.5, y: 1 }}
      locations={gradients.surfaceRaise.locations}
      start={{ x: 0.5, y: 0 }}
      style={styles.row}
    >
      <View style={styles.body}>
        <Text
          maxFontSizeMultiplier={MAX_TEXT_SCALE}
          numberOfLines={2}
          style={[styles.title, failed && styles.failed]}
        >
          {item.title}
        </Text>
        {item.detail === null ? null : (
          <Text maxFontSizeMultiplier={MAX_TEXT_SCALE} numberOfLines={2} selectable style={styles.detail}>
            {item.detail}
          </Text>
        )}
      </View>

      <View style={styles.trailing}>
        {/* The amount's line is held even when there is no amount, so the time always sits on the
            second line and the times form one column down the feed. */}
        {value === null ? <View style={styles.amountLine} /> : (
          <Text
            maxFontSizeMultiplier={MAX_TEXT_SCALE}
            numberOfLines={1}
            selectable
            style={[styles.amount, { color: activityAmountColor(direction) }]}
          >
            {value}
          </Text>
        )}
        <Text maxFontSizeMultiplier={MAX_TEXT_SCALE} numberOfLines={1} style={styles.time}>
          {time}
        </Text>
      </View>
    </LinearGradient>
  );
}

/**
 * The row's own shape, waiting for data: the same card, a name over its particulars on the left and an
 * amount over a time on the right, each bar on the leading of the line it stands in for, so the row that
 * lands is the row that was held.
 */
export function ActivityRowSkeleton() {
  return (
    <LinearGradient
      colors={gradients.surfaceRaise.colors}
      end={{ x: 0.5, y: 1 }}
      locations={gradients.surfaceRaise.locations}
      start={{ x: 0.5, y: 0 }}
      style={styles.row}
    >
      <View style={styles.body}>
        <SkeletonText metrics={interfaceType.cardTitle} width="56%" />
        <SkeletonText metrics={interfaceType.footnote} width="38%" />
      </View>
      <View style={styles.trailing}>
        <SkeletonText align="right" metrics={interfaceType.figure} width={72} />
        <SkeletonText align="right" metrics={interfaceType.figureFootnote} width={96} />
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    overflow: 'hidden',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  // `minWidth: 0` is what lets the title wrap rather than forcing the row wider than the card: a flex
  // child's default minimum is its content, so one long unbroken title would push the amount off the
  // edge instead of taking a second line.
  body: { flex: 1, minWidth: 0, gap: 2 },
  title: { ...interfaceType.cardTitle, color: colors.textPrimary },
  failed: { color: colors.negative },
  // A step under a caption, so the particulars sit well back from the name and the amount above them.
  detail: { ...interfaceType.footnote, color: colors.textMuted },
  // Never shrinks: the amount is the reason this column exists. Ranged right so the figures form a
  // column a reader can scan down instead of a ragged edge that follows the titles.
  trailing: { flexShrink: 0, maxWidth: AMOUNT_MAX_WIDTH, alignItems: 'flex-end', gap: 2 },
  amount: { ...interfaceType.figure, textAlign: 'right' },
  amountLine: { height: interfaceType.figure.lineHeight },
  time: { ...interfaceType.figureFootnote, color: colors.textMuted, textAlign: 'right' },
});
