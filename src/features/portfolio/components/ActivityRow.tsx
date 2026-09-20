import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, Text, View } from 'react-native';

import { Skeleton, SkeletonText } from '@/components/feedback/Skeleton';
import {
  ActivityMark,
  activityAmountColor,
  activityDirection,
} from '@/features/portfolio/components/ActivityMark';
import {
  TokenPairMark,
  TOKEN_PAIR_HEIGHT,
  TOKEN_PAIR_WIDTH,
} from '@/features/portfolio/components/TokenMark';
import type { ActivityItem } from '@/features/portfolio/components/activityItems';
import { colors, gradients, radii, spacing, typography } from '@/theme/tokens';

/** Matched to the notification rows' mark, so one leading glyph size runs through the app. */
const MARK = 26;

/**
 * The slot both a direction glyph and a swap's asset pair sit in.
 *
 * Width is pinned to the single glyph and deliberately not widened for the pair, because the title
 * column has no room to give: `Moved to public wallet` measures within a few points of the space it
 * has, and a wrapped title is the one thing on this row that does make the card taller.
 *
 * Height is the taller of the two. This is the free dimension — the row is sized by its trailing
 * column, an amount over a timestamp, so anything up to that height costs nothing.
 */
const MARK_SLOT = Math.max(MARK, TOKEN_PAIR_WIDTH);
const MARK_SLOT_HEIGHT = Math.max(MARK, TOKEN_PAIR_HEIGHT);

/** What the row is actually as tall as, and therefore the budget the mark has to stay inside. */
const TRAILING_HEIGHT = typography.label.lineHeight + typography.eyebrow.lineHeight;

/**
 * Centres the slot in the height the row already has.
 *
 * It used to centre on the title's single line, which was right for a 26pt mark and impossible for a
 * 34pt one — the arithmetic went negative and would have pulled the mark up into the card's padding.
 * Centring on the trailing column instead keeps both mark sizes inside a box the row was going to be
 * anyway, so neither can change its height.
 */
const MARK_TOP = (TRAILING_HEIGHT - MARK_SLOT_HEIGHT) / 2;

/**
 * How much of the row the amount may claim.
 *
 * Token amounts here are unrounded — `0.009271901 SOL` is a real row — and the amount is the thing
 * this column exists for, so it never shrinks or wraps; the title wraps instead. The cap stops a
 * pathological figure from taking the whole row and leaving no title at all.
 */
const AMOUNT_MAX_WIDTH = '54%';

const MAX_TEXT_SCALE = 1.3;

const DATE_FORMATTER = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  month: 'short',
});

/**
 * One event in the history: what happened on the left, what it was worth on the right.
 *
 * Two columns rather than two stacked lines. The old row put the title and the amount on one line
 * with the title on `flex: 1`, which meant the longest amounts — a swap printed both of its legs
 * there — ate the row and ellipsised the title down to "Swapped …". Amounts now own a column of their
 * own, right-ranged and tabular so the decimal points line up down the feed, with the timestamp
 * underneath as the only thing that qualifies them.
 *
 * The supporting line is gone from every wallet movement, because it was ceremony: it restated the
 * wallet, asserted a confirmation implied by the row existing, and repeated the timestamp. Trades
 * keep theirs — size, price and fee are figures, and there is nowhere else for them.
 *
 * The card material is the order buttons' and the notification rows': `surfaceRaise` top to bottom
 * under a 1pt rim. The comment this file used to carry argued that a ramp repeated down forty rows
 * reads as stripes, and it was right about rows sharing one container edge to edge — a sawtooth of
 * light-dark-light-dark with nothing between the repeats. Separated cards break that: each one is
 * bounded by its own rim and by a gap of page darker than the ramp's own base, so it reads as forty
 * surfaces rather than as a striped one.
 */
export function ActivityRow({ item }: { readonly item: ActivityItem }) {
  const direction = activityDirection(item);

  return (
    <LinearGradient
      colors={gradients.surfaceRaise.colors}
      end={{ x: 0.5, y: 1 }}
      locations={gradients.surfaceRaise.locations}
      start={{ x: 0.5, y: 0 }}
      style={styles.row}
    >
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        pointerEvents="none"
        style={styles.mark}
      >
        {item.pair === undefined ? (
          <ActivityMark direction={direction} item={item} size={MARK} />
        ) : (
          <TokenPairMark received={item.pair.received} spent={item.pair.spent} />
        )}
      </View>

      <View style={styles.body}>
        <Text maxFontSizeMultiplier={MAX_TEXT_SCALE} numberOfLines={2} style={styles.title}>
          {item.title}
        </Text>
        {item.detail === null ? null : (
          <Text
            maxFontSizeMultiplier={MAX_TEXT_SCALE}
            numberOfLines={1}
            selectable
            style={styles.detail}
          >
            {item.detail}
          </Text>
        )}
      </View>

      <View style={styles.trailing}>
        {item.value === null ? null : (
          <Text
            maxFontSizeMultiplier={MAX_TEXT_SCALE}
            numberOfLines={1}
            selectable
            style={[styles.amount, { color: activityAmountColor(direction) }]}
          >
            {item.value}
          </Text>
        )}
        <Text maxFontSizeMultiplier={MAX_TEXT_SCALE} numberOfLines={1} style={styles.time}>
          {DATE_FORMATTER.format(new Date(item.createdAtMs))}
        </Text>
      </View>
    </LinearGradient>
  );
}

/**
 * The row's own shape, waiting for data.
 *
 * Built from the row's constants and the row's style rather than approximated, so the card that
 * appears while history loads is the card that lands when it arrives: same material, same corner,
 * same mark slot, and the same trailing block of an amount over a timestamp. It replaced three bare
 * text bars floating on the page, which promised a list of lines and then delivered a list of cards.
 *
 * Sized for a one-line title and no supporting line — the shape most rows take — so a feed that
 * settles mostly stays where it was rather than growing under the reader.
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
      <View style={styles.mark}>
        <Skeleton height={MARK} radius={radii.pill} width={MARK} />
      </View>
      <View style={styles.body}>
        <SkeletonText role="label" width="76%" />
      </View>
      <View style={styles.trailing}>
        <SkeletonText align="right" role="label" width={102} />
        <SkeletonText align="right" role="eyebrow" width={74} />
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    overflow: 'hidden',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radii.lg,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderColor: colors.border,
  },
  // Fixed box, so a swap's overlapped pair and a single direction glyph leave every title in the feed
  // starting at the same x. Contents centre inside it, which is what lets the shorter pair share the
  // taller glyph's optical line without a second offset to keep in step.
  mark: {
    width: MARK_SLOT,
    height: MARK_SLOT_HEIGHT,
    marginTop: MARK_TOP,
    flexShrink: 0,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  // `minWidth: 0` is what lets the title wrap rather than forcing the row wider than the card: a flex
  // child's default minimum is its content, so one long unbroken title would push the amount off the
  // edge instead of taking a second line.
  body: { flex: 1, minWidth: 0 },
  title: { ...typography.label, color: colors.textPrimary },
  detail: { ...typography.caption, color: colors.textMuted },
  // Never shrinks: the amount is the reason this column exists. Ranged right so the figures form a
  // column a reader can scan down instead of a ragged edge that follows the titles.
  trailing: { flexShrink: 0, maxWidth: AMOUNT_MAX_WIDTH, alignItems: 'flex-end' },
  amount: { ...typography.label, textAlign: 'right', fontVariant: ['tabular-nums'] },
  // Under the amount rather than on a line of its own across the row. It is what qualifies the
  // figure, and on its own line it was the least specific value on the row taking the most space.
  time: {
    ...typography.eyebrow,
    letterSpacing: 0,
    color: colors.textMuted,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
});
