import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  FadeIn,
  LayoutAnimationConfig,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';

import { SkeletonText } from '@/components/feedback/Skeleton';
import { layoutMorph } from '@/components/motion/layoutMorph';
import { PressableScale } from '@/components/ui/PressableScale';
import { UnderlineTabs, type UnderlineTabOption } from '@/components/ui/UnderlineTabs';
import { formatCompactTokenPrice, formatSignedBpsPercent } from '@/domain/money/amount';
import { MarketLogo } from '@/features/trade/components/MarketLogo';
import type {
  PacificaMarket,
  PacificaMarketSnapshot,
} from '@/integrations/perps/pacifica/pacificaMarketData';
import {
  readMarketBookmarks,
  subscribeMarketBookmarks,
  toggleMarketBookmark,
} from '@/storage/marketBookmarks';
import { colors, motion, radii, spacing, typography } from '@/theme/tokens';

/** How many rows each ranked tab shows. Enough to scan, short enough to stay above the fold. */
const MOVER_COUNT = 4;

/** Sized to the ticker beside it, so the ribbon reads as part of that line rather than as chrome. */
const BOOKMARK_SIZE = 16;

/**
 * The ribbon, drawn once and reused for both states.
 *
 * Rounded top corners and a rounded notch, matching the app's other glyphs. Every coordinate is
 * written out rather than leaning on SVG's implicit number separators — `a.9.9 0 0 1` is legal
 * but relies on the parser splitting a run of decimals, which is not worth betting a glyph on.
 */
const BOOKMARK_PATH =
  'M8 3.5h8a2 2 0 0 1 2 2v14.1a0.9 0.9 0 0 1 -1.38 0.76L12 17.2l-4.62 3.16A0.9 0.9 0 0 1 6 19.6V5.5a2 2 0 0 1 2 -2Z';

/** One market and the venue's current reading for it. */
export type MoverEntry = {
  readonly market: PacificaMarket;
  readonly snapshot: PacificaMarketSnapshot;
};

type MoverFilter = 'gainers' | 'losers' | 'bookmarks';

const FILTERS: readonly UnderlineTabOption<MoverFilter>[] = [
  { id: 'gainers', label: 'Gainers' },
  { id: 'losers', label: 'Losers' },
  { id: 'bookmarks', label: 'Bookmarks' },
];

/**
 * Where the venue is moving, and the markets the reader chose to keep.
 *
 * Three views of one list behind a tab strip, rather than the stacked "Top gainers" and
 * "Top losers" blocks this replaces. Both ends of the same ranking were always visible at
 * once, which spent two screens of height to say one thing; a filter spends the height once
 * and buys a third view — the reader's own bookmarks — for free.
 *
 * The section takes the whole ranked catalog and slices it here rather than being handed
 * pre-cut lists, because the tabs decide which slice matters and the parent should not have
 * to know that. `entries` is expected sorted by 24h change, descending.
 */
export function MarketMoversSection({
  entries,
  onSelect,
  pending,
}: {
  readonly entries: readonly MoverEntry[];
  readonly onSelect: (venueRef: string) => void;
  readonly pending: boolean;
}) {
  const [filter, setFilter] = useState<MoverFilter>('gainers');
  const bookmarks = useSyncExternalStore(
    subscribeMarketBookmarks,
    readMarketBookmarks,
    readMarketBookmarks,
  );
  // A set for the per-row lookup, so drawing the list is linear in the rows drawn rather
  // than in the rows times the bookmarks.
  const saved = useMemo(() => new Set(bookmarks), [bookmarks]);

  const visible = useMemo<readonly MoverEntry[]>(() => {
    if (filter === 'gainers') return entries.slice(0, MOVER_COUNT);
    if (filter === 'losers') return entries.slice(-MOVER_COUNT).reverse();

    // Bookmarks keep the order they were saved in. They are also resolved through an index
    // rather than searched one at a time: `entries` is rebuilt on every price batch, so this
    // runs at feed rate for as long as the tab is open.
    const byRef = new Map(entries.map((entry) => [entry.market.venueRef, entry]));

    return bookmarks.flatMap((ref) => {
      const entry = byRef.get(ref);
      return entry === undefined ? [] : [entry];
    });
  }, [bookmarks, entries, filter]);

  // Bookmarks shimmer only for rows that are actually coming: with none saved there is
  // nothing to wait for, so that tab goes straight to its empty state even mid-load.
  const placeholders = filter === 'bookmarks' ? bookmarks.length : MOVER_COUNT;

  return (
    <View style={styles.section}>
      {/* The strip sits on its own hairline so the active tab's accent rule lands on that
          line, which is what ties the selection to the list it filters. */}
      <View style={styles.filter}>
        <UnderlineTabs onSelect={setFilter} options={FILTERS} selectedId={filter} />
      </View>

      {/* The box morphs and the rows inside it morph with it, and it takes both.

          The box: each tab returns a different number of rows, so this height changes on every
          switch, and the spring turns that from a snap into a settle. The section below travels on
          the same spring, so the whole column moves as one.

          The rows: `layout` on the box alone was not enough, because a filter swap does not resize
          a stable list — it replaces the rows with different components under different keys.
          Reanimated's `layout` only animates a view present in both renders, so the box sprang
          while every row inside it teleported, and the section read as unanimated. Each row now
          carries the same spring, so a market appearing under two filters slides between its two
          positions instead of jumping.

          `skipEntering` keeps the first paint still: without it every row would fade in behind the
          section's own `RiseInView` entrance. */}
      <LayoutAnimationConfig skipEntering>
        <Animated.View layout={layoutMorph()} style={styles.list}>
          {pending && placeholders > 0 ? (
            Array.from({ length: placeholders }, (_unused, index) => (
              <View key={index} style={styles.row}>
                <SkeletonText role="label" width={110} />
                <SkeletonText align="right" role="label" width={90} />
              </View>
            ))
          ) : visible.length === 0 ? (
            <Text accessibilityLiveRegion="polite" style={styles.empty}>
              {filter === 'bookmarks'
                ? 'No bookmarks yet. Tap the ribbon on any market to keep it here.'
                : 'No markets reported by Pacifica.'}
            </Text>
          ) : (
            visible.map(({ market, snapshot }) => (
              <MoverRow
                bookmarked={saved.has(market.venueRef)}
                key={market.venueRef}
                market={market}
                onSelect={onSelect}
                snapshot={snapshot}
              />
            ))
          )}
        </Animated.View>
      </LayoutAnimationConfig>
    </View>
  );
}

/**
 * One market: the row opens it, the ribbon at the end saves it.
 *
 * They are siblings rather than nested, and that is an accessibility constraint rather than a
 * layout preference. A `Pressable` is one accessibility element by default, so a toggle placed
 * inside the row's own pressable would be swallowed by it and unreachable — the market and the
 * bookmark are two actions, so they are two controls.
 */
function MoverRow({
  bookmarked,
  market,
  onSelect,
  snapshot,
}: {
  readonly bookmarked: boolean;
  readonly market: PacificaMarket;
  readonly onSelect: (venueRef: string) => void;
  readonly snapshot: PacificaMarketSnapshot;
}) {
  const change = snapshot.change24hBps;
  const price = formatCompactTokenPrice(snapshot.price);
  const changeText = formatSignedBpsPercent(change);

  return (
    // `layout` carries a row that survives the swap to its new slot; `entering` covers the rows
    // that are new to this filter, which have no previous frame to travel from. No `exiting`: a
    // departing row is fading out inside a box that is already shrinking past it, so the two fight
    // over the same pixels and the clip cuts the loser anyway.
    <Animated.View
      entering={FadeIn.duration(motion.rowSwap.fadeMs)}
      layout={layoutMorph()}
      style={styles.row}
    >
      <Pressable
        accessibilityHint="Opens market details"
        accessibilityLabel={`${market.baseAsset}, ${price}, ${changeText} over 24 hours`}
        accessibilityRole="button"
        onPress={() => onSelect(market.venueRef)}
        style={({ pressed }) => [styles.body, pressed && styles.pressed]}
      >
        <View style={styles.identity}>
          <MarketLogo symbol={market.baseAsset} url={market.iconUrl} />
          <Text numberOfLines={1} style={styles.symbol}>{market.baseAsset}</Text>
        </View>
        <View style={styles.values}>
          <Text style={styles.price}>{price}</Text>
          <Text style={[styles.change, change < 0 ? styles.negative : styles.positive]}>
            {changeText}
          </Text>
        </View>
      </Pressable>
      <BookmarkToggle
        bookmarked={bookmarked}
        symbol={market.baseAsset}
        venueRef={market.venueRef}
      />
    </Animated.View>
  );
}

/**
 * Saving a market, and giving it up.
 *
 * The two states are two stacked copies of the same ribbon — a muted outline, and a solid violet
 * one crossfading over it. Neither `fill` nor `stroke` can be interpolated on an SVG path, so a
 * second layer is the only way the change can be anything but instant, and it is the same
 * arrangement the tab bar uses for its selected glyphs.
 *
 * Scale and fill run off separate values because they are separate statements: the fill says
 * which state the ribbon is in, and the scale says which direction it just travelled. See
 * `motion.bookmarkToggle` for why saving overshoots and unsaving dips.
 */
function BookmarkToggle({
  bookmarked,
  symbol,
  venueRef,
}: {
  readonly bookmarked: boolean;
  readonly symbol: string;
  readonly venueRef: string;
}) {
  const reduceMotion = useReducedMotion();
  const toggle = useCallback(() => toggleMarketBookmark(venueRef), [venueRef]);
  const fill = useSharedValue(bookmarked ? 1 : 0);
  const pop = useSharedValue(1);
  // Whether this row has drawn once already. Without it, switching to the bookmarks tab would
  // pop every ribbon in the list on arrival, which turns a confirmation into a fanfare.
  const drawn = useRef(false);

  useEffect(() => {
    const target = bookmarked ? 1 : 0;

    if (!drawn.current || reduceMotion) {
      drawn.current = true;
      fill.set(target);
      pop.set(1);
      return;
    }

    fill.set(withTiming(target, {
      duration: bookmarked
        ? motion.bookmarkToggle.fillInMs
        : motion.bookmarkToggle.fillOutMs,
    }));
    // Out on the timing, back on the spring: the leg away from rest is a deliberate, even
    // movement, and the leg home is elastic, so the glyph settles instead of stopping dead.
    pop.set(withSequence(
      withTiming(
        bookmarked ? motion.bookmarkToggle.popScale : motion.bookmarkToggle.dipScale,
        { duration: bookmarked ? motion.bookmarkToggle.popMs : motion.bookmarkToggle.dipMs },
      ),
      withSpring(1, motion.spring),
    ));
  }, [bookmarked, fill, pop, reduceMotion]);

  const glyphStyle = useAnimatedStyle(() => ({ transform: [{ scale: pop.value }] }));
  const fillStyle = useAnimatedStyle(() => ({ opacity: fill.value }));

  return (
    <PressableScale
      accessibilityHint="Keeps this market under the bookmarks filter"
      accessibilityLabel={bookmarked ? `Remove ${symbol} from bookmarks` : `Bookmark ${symbol}`}
      accessibilityRole="button"
      accessibilityState={{ selected: bookmarked }}
      hitSlop={10}
      onPress={toggle}
      style={styles.toggle}
    >
      {/* The scale sits on a wrapper rather than on the pressable itself, so it composes with
          `PressableScale`'s own press dip instead of overwriting it. */}
      <Animated.View style={glyphStyle}>
        <BookmarkGlyph tone={colors.textMuted} />
        <Animated.View style={[StyleSheet.absoluteFill, styles.centre, fillStyle]}>
          <BookmarkGlyph filled tone={colors.accentSoft} />
        </Animated.View>
      </Animated.View>
    </PressableScale>
  );
}

/**
 * One ribbon in one tone. `filled` swaps the interior on, and the stroke stays either way so
 * both layers keep exactly the same silhouette and optical weight — a solid drawn without the
 * stroke would sit a stroke-width inside the outline and the crossfade would visibly shrink.
 *
 * Saved takes `accentSoft`, the same tone the tab strip above uses for its active label, so one
 * violet means "chosen" in both places.
 */
function BookmarkGlyph({
  filled = false,
  tone,
}: {
  readonly filled?: boolean;
  readonly tone: string;
}) {
  return (
    <Svg height={BOOKMARK_SIZE} viewBox="0 0 24 24" width={BOOKMARK_SIZE}>
      <Path
        d={BOOKMARK_PATH}
        fill={filled ? tone : 'none'}
        stroke={tone}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.7}
      />
    </Svg>
  );
}

const styles = StyleSheet.create({
  section: { gap: spacing.xxs },
  filter: {
    marginBottom: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  // Carries the row rhythm that `section`'s own gap used to supply. The rows are one level
  // deeper now that they share an animated wrapper, so the gap has to follow them down.
  //
  // Clipped, and that is what makes the morph read as a shape rather than as a slide. The rows are
  // laid out at their final size the instant the filter changes while the box is still travelling
  // to meet them, so on a switch that adds rows the overflow would spill over the section below
  // for the length of the spring. Clipping turns the same frames into the box opening to reveal
  // them. On a switch that removes rows the content already fits and this does nothing.
  list: { overflow: 'hidden', gap: spacing.xxs },
  // The rule spans the toggle's column too, so the list reads as full-width rows rather than
  // as a table with a stripe of unruled margin down its right edge.
  row: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  body: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingVertical: spacing.xxs,
  },
  identity: {
    flexShrink: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  symbol: { ...typography.label, flexShrink: 1, color: colors.textPrimary },
  values: { flexShrink: 0, alignItems: 'flex-end' },
  price: { ...typography.label, color: colors.textPrimary },
  change: { ...typography.caption },
  toggle: {
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingLeft: spacing.sm,
  },
  // Holds the filled layer exactly over the outline it covers. The two are the same 16pt box, so
  // this only guards against a rounding difference pushing one off the other by a subpixel.
  centre: { alignItems: 'center', justifyContent: 'center' },
  empty: {
    ...typography.bodyCompact,
    paddingVertical: spacing.sm,
    color: colors.textMuted,
  },
  positive: { color: colors.positive },
  negative: { color: colors.negative },
  pressed: { opacity: 0.6, borderRadius: radii.xs },
});
