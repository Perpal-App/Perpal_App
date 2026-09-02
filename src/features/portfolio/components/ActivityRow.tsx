import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import type { ActivityItem } from '@/features/portfolio/components/activityItems';
import { colors, spacing, typography } from '@/theme/tokens';

const GLYPH_SIZE = 20;
const DATE_FORMATTER = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  month: 'short',
});

/**
 * One event in the history: what happened, what it was worth, and when.
 *
 * Two lines, not three. The timestamp used to hold a line of its own, which made every row in a
 * forty-row feed three lines tall and gave the least specific value on the row the most space.
 *
 * Flat, with a hairline under it. The raised card material the positions above use is deliberately
 * kept off this list — a ramp repeated down forty rows stops reading as a surface and starts reading
 * as stripes.
 */
export function ActivityRow({
  item,
  last,
}: {
  readonly item: ActivityItem;
  readonly last: boolean;
}) {
  // Direction is read from the formatted value rather than the event type, because that is where the
  // sign already lives: a funding payment can be either way round, and re-deriving it from the kind
  // would disagree with the number printed beside it.
  const color = item.outcome === 'error'
    ? colors.negative
    : item.value?.startsWith('+$')
      ? colors.positive
      : item.value?.startsWith('-$')
        ? colors.negative
        : colors.textPrimary;

  return (
    <View style={[styles.row, last && styles.rowLast]}>
      {/* A bare glyph, not a bordered tile. The tile put a second surface and a second radius on
          every row of a feed, which is what made the list read as a stack of objects rather than as
          history. */}
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={styles.icon}
      >
        <ActivityGlyph item={item} />
      </View>
      <View style={styles.body}>
        <View style={styles.rowTop}>
          <Text numberOfLines={1} style={styles.title}>{item.title}</Text>
          {item.value === null ? null : (
            <Text selectable style={[styles.value, { color }]}>{item.value}</Text>
          )}
        </View>
        <Text numberOfLines={2} selectable style={styles.detail}>
          {`${item.detail} · ${formatTime(item.createdAtMs)}`}
        </Text>
      </View>
    </View>
  );
}

/**
 * The mark that opens a row: what happened, and whether it worked.
 *
 * Drawn here rather than pulled from an icon font, like every other glyph in the app. Direction is
 * the whole vocabulary — down for value arriving, up for value leaving, a rising line for a trade —
 * and a failure takes the alert shape as well as the loss colour, so an error is never read from
 * tone alone.
 */
function ActivityGlyph({ item }: { readonly item: ActivityItem }) {
  const tone = item.outcome === 'error' ? colors.negative : colors.textSecondary;
  const stroke = {
    fill: 'none',
    stroke: tone,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    strokeWidth: 1.8,
  } as const;

  return (
    <Svg height={GLYPH_SIZE} viewBox="0 0 24 24" width={GLYPH_SIZE}>
      {item.outcome === 'error' ? (
        <>
          <Circle {...stroke} cx="12" cy="12" r="8.4" />
          <Path {...stroke} d="M12 7.8v4.8" />
          <Circle cx="12" cy="16.1" fill={tone} r="1.1" />
        </>
      ) : item.kind === 'trade' ? (
        <>
          <Path {...stroke} d="M4 16.4 9.2 11.2 13 15 20 8" />
          <Path {...stroke} d="M15.4 8h4.6v4.6" />
        </>
      ) : item.kind === 'funding' ? (
        <>
          <Path {...stroke} d="M12 4.6v14.2" />
          <Path {...stroke} d="M6.4 13.2 12 18.8 17.6 13.2" />
        </>
      ) : (
        <>
          <Path {...stroke} d="M12 19.4V5.2" />
          <Path {...stroke} d="M6.4 10.8 12 5.2 17.6 10.8" />
        </>
      )}
    </Svg>
  );
}

function formatTime(timeMs: number): string {
  return DATE_FORMATTER.format(new Date(timeMs));
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowLast: { borderBottomWidth: 0 },
  // Fixed width, so every title in the feed starts at the same x whatever glyph opens its row.
  icon: {
    width: GLYPH_SIZE,
    flexShrink: 0,
    alignItems: 'center',
    // Nudged to sit on the title's cap height rather than centred against a two-line block.
    paddingTop: 2,
  },
  body: { flex: 1, minWidth: 0, gap: 2 },
  rowTop: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm },
  title: { ...typography.label, flex: 1, color: colors.textPrimary },
  value: { ...typography.label, fontVariant: ['tabular-nums'] },
  detail: { ...typography.caption, color: colors.textMuted },
});
