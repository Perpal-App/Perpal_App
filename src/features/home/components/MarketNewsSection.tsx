import { Alert, Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { SkeletonText } from '@/components/feedback/Skeleton';
import type { MarketBriefingState } from '@/features/home/hooks/useMarketBriefing';
import type { NewsCategory } from '@/integrations/market-data/marketBriefing';
import { colors, spacing, typography } from '@/theme/tokens';

const LABELS: Readonly<Record<NewsCategory, string>> = {
  crypto: 'CRYPTO',
  perps: 'PERPS',
  'us-crypto': 'US CRYPTO',
  fed: 'FED',
  markets: 'MARKETS',
};

export function MarketNewsSection({ data, status }: MarketBriefingState) {
  return (
    <View style={styles.section}>
      <View style={styles.header}>
        <Text accessibilityRole="header" style={styles.title}>Market news</Text>
        {data !== null ? <Text style={styles.source}>{data.source}</Text> : null}
      </View>

      {data === null ? (
        status === 'loading'
          ? Array.from({ length: 4 }, (_unused, index) => (
            <View key={index} style={styles.item}><SkeletonText role="label" width="90%" /></View>
          ))
          : <Text accessibilityRole="alert" style={styles.unavailable}>News unavailable</Text>
      ) : data.news.slice(0, 6).map((article) => (
        <Pressable
          accessibilityHint="Opens the source article"
          accessibilityRole="link"
          key={article.url}
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
      ))}
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
  header: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginBottom: spacing.xxs,
  },
  title: { ...typography.label, color: colors.textSecondary },
  source: { ...typography.caption, color: colors.textMuted },
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
