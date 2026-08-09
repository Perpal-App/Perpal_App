import { useMemo, useState } from 'react';
import { Alert, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, LayoutAnimationConfig } from 'react-native-reanimated';

import { SkeletonText } from '@/components/feedback/Skeleton';
import { layoutMorph } from '@/components/motion/layoutMorph';
import { UnderlineTabs, type UnderlineTabOption } from '@/components/ui/UnderlineTabs';
import { MajorEventsList } from '@/features/home/components/MajorEventsList';
import type { MarketBriefingState } from '@/features/home/hooks/useMarketBriefing';
import type { NewsCategory } from '@/integrations/market-data/marketBriefing';
import { colors, motion, spacing, typography } from '@/theme/tokens';

/** The tag printed on each article. All caps, so it reads as a label rather than as prose. */
const LABELS: Readonly<Record<NewsCategory, string>> = {
  crypto: 'CRYPTO',
  perps: 'PERPS',
  'us-crypto': 'US CRYPTO',
  fed: 'FED',
  markets: 'MARKETS',
};

/**
 * The same categories as tab labels, in sentence case.
 *
 * Separate from `LABELS` rather than shared with it: a tag is a shout and a tab is something
 * you read and press. A strip of all-caps tabs reads as a row of headers, not as controls.
 */
const TAB_LABELS: Readonly<Record<NewsCategory, string>> = {
  crypto: 'Crypto',
  perps: 'Perps',
  'us-crypto': 'US crypto',
  fed: 'Fed',
  markets: 'Markets',
};

/**
 * Tab order, the venue's own category first.
 *
 * Fixed here rather than taken from the payload's order or sorted by article count, so the
 * strip does not reshuffle under the reader's thumb on every refresh.
 */
const CATEGORY_ORDER: readonly NewsCategory[] = [
  'perps',
  'crypto',
  'us-crypto',
  'fed',
  'markets',
];

/** Articles shown at once, which is this section's share of the screen. */
const MAX_ARTICLES = 6;

/**
 * The scheduled calendar is a tab here rather than a section of its own.
 *
 * It comes from the same briefing request as the articles, and it answers the neighbouring
 * question — what has happened, and what is about to. Last in the strip because it is a
 * different kind of content from the category filters before it, so it reads as a change of
 * view rather than as one more slice of the news.
 */
type NewsFilter = 'all' | NewsCategory | 'events';

export function MarketNewsSection({ data, status }: MarketBriefingState) {
  const [filter, setFilter] = useState<NewsFilter>('all');

  // Only categories the feed actually carries get a tab. The briefing does not promise every
  // category on every refresh, and a tab that filters to nothing is a dead end.
  //
  // Events are the exception: that tab appears whenever the briefing answered at all, even
  // with an empty calendar, because "nothing scheduled" is itself worth being able to look up.
  const options = useMemo<readonly UnderlineTabOption<NewsFilter>[]>(() => {
    if (data === null) return [{ id: 'all', label: 'All' }];

    const present = new Set(data.news.map((article) => article.category));

    return [
      { id: 'all', label: 'All' },
      ...CATEGORY_ORDER
        .filter((category) => present.has(category))
        .map((category) => ({ id: category, label: TAB_LABELS[category] })),
      { id: 'events', label: 'Events' },
    ];
  }, [data]);

  // Derived, not corrected in an effect. If a refresh drops the category being read, its tab
  // goes with it, and the selection has to fall back within the same render — otherwise the
  // list empties with no tab selected to explain why.
  const active = options.some((option) => option.id === filter) ? filter : 'all';

  const articles = useMemo(() => {
    const all = data?.news ?? [];
    const scoped = active === 'all' || active === 'events'
      ? all
      : all.filter((article) => article.category === active);

    return scoped.slice(0, MAX_ARTICLES);
  }, [active, data]);

  return (
    <View style={styles.section}>
      {/* No source list. The briefing reports every outlet it drew from, which ran to a line of
          provider names wider than the screen and truncated mid-word — a credit line billed as
          a headline. Each article already names its own source on the row that carries it,
          which is where that information is actually useful. */}
      <Text accessibilityRole="header" style={styles.title}>
        {active === 'events' ? 'Major U.S. events' : 'Market news'}
      </Text>

      {/* A lone "All" tab filters nothing, so the strip only earns its row once the feed
          carries more than one view. */}
      {options.length > 1 ? (
        <View style={styles.filter}>
          <UnderlineTabs onSelect={setFilter} options={options} selectedId={active} />
        </View>
      ) : null}

      {/* Same morph as the movers strip above, on the same spring, and for the same two reasons.

          The box resizes on nearly every tab — six crypto articles, one Fed article and the events
          calendar are all very different heights — and being the last section on the screen its
          height is also the scroll content's height.

          Each article also animates in its own right. A tab swap replaces the list with different
          articles under different keys, and `layout` only animates a view that exists in both
          renders, so without this the box sprang while the articles inside it swapped instantly.
          An article that appears under both "All" and its own category now slides between the two
          positions rather than jumping. */}
      <LayoutAnimationConfig skipEntering>
        <Animated.View layout={layoutMorph()} style={styles.list}>
          {data === null ? (
            status === 'loading'
              ? Array.from({ length: 4 }, (_unused, index) => (
                <View key={index} style={styles.item}>
                  <SkeletonText role="label" width="90%" />
                </View>
              ))
              : <Text accessibilityRole="alert" style={styles.unavailable}>News unavailable</Text>
          ) : active === 'events' ? (
            <MajorEventsList data={data} status={status} />
          ) : articles.map((article) => (
            // The animation sits on a wrapper rather than on the Pressable so the row keeps its
            // own `pressed` style function, which an animated component would have to give up.
            <Animated.View
              entering={FadeIn.duration(motion.rowSwap.fadeMs)}
              key={article.url}
              layout={layoutMorph()}
            >
              <Pressable
                accessibilityHint="Opens the source article"
                accessibilityRole="link"
                onPress={() => void openArticle(article.url)}
                style={({ pressed }) => [styles.item, pressed && styles.pressed]}
              >
                <View style={styles.meta}>
                  <Text style={styles.category}>{LABELS[article.category]}</Text>
                  <Text numberOfLines={1} style={styles.metaText}>
                    {article.source} · {formatTime(article.publishedAtMs)}
                  </Text>
                </View>
                <Text numberOfLines={3} style={styles.headline}>{article.headline}</Text>
              </Pressable>
            </Animated.View>
          ))}
        </Animated.View>
      </LayoutAnimationConfig>
    </View>
  );
}

async function openArticle(url: string): Promise<void> {
  try {
    await Linking.openURL(url);
  } catch {
    Alert.alert('Article unavailable', 'The source link could not be opened.');
  }
}

function formatTime(timeMs: number): string {
  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    month: 'short',
  }).format(new Date(timeMs));
}

const styles = StyleSheet.create({
  section: { gap: spacing.xxs },
  // `textPrimary`, matching the Fear & Greed heading and the notifications sheet. At
  // `textSecondary` it sat below the active tab under it in brightness, which inverted the
  // hierarchy — a section heading should not be the dimmest thing in its own section.
  title: {
    ...typography.label,
    marginBottom: spacing.xxs,
    color: colors.textPrimary,
  },
  // The strip sits on its own hairline so the active tab's rule lands on that line, which is
  // what ties a selection to the list under it. Matches the movers strip above.
  filter: {
    marginBottom: spacing.xxs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  // Carries the item rhythm that `section`'s own gap used to supply, now that the articles sit one
  // level deeper inside the animated wrapper. Clipped for the same reason as the movers list: the
  // rows reach their final size before the box does, so on a switch that adds height the overflow
  // would spill past the box until the spring caught up.
  list: { overflow: 'hidden', gap: spacing.xxs },
  item: {
    gap: spacing.xxs,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  meta: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  category: { ...typography.eyebrow, color: colors.accent },
  metaText: { ...typography.caption, flex: 1, color: colors.textMuted },
  headline: { ...typography.bodyCompact, color: colors.textPrimary },
  unavailable: { ...typography.bodyCompact, color: colors.textMuted },
  pressed: { opacity: 0.6 },
});
