import { useState, useSyncExternalStore } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';

import { IconButton } from '@/components/ui/IconButton';
import type { MarketNewsArticle } from '@/integrations/market-data/marketBriefing';
import {
  readInAppNotifications,
  subscribeInAppNotifications,
  type InAppNotification,
} from '@/storage/inAppNotifications';
import { colors, layout, radii, spacing, typography } from '@/theme/tokens';

export function NotificationsPanel({
  latestNews,
  topGainer,
  topLoser,
}: {
  readonly latestNews: MarketNewsArticle | null;
  readonly topGainer: string | null;
  readonly topLoser: string | null;
}) {
  const [visible, setVisible] = useState(false);
  const activity = useSyncExternalStore(
    subscribeInAppNotifications,
    readInAppNotifications,
    readInAppNotifications,
  );

  return (
    <>
      <View style={styles.trigger}>
        <IconButton
          accessibilityHint="Opens trade, funding, withdrawal, and wallet events"
          accessibilityLabel={`Notifications, ${activity.length} events`}
          onPress={() => setVisible(true)}
          size={44}
        >
          <BellIcon />
        </IconButton>
        {activity.length > 0 ? (
          <View accessibilityElementsHidden pointerEvents="none" style={styles.badge}>
            <Text style={styles.badgeText}>
              {activity.length > 99 ? '99+' : activity.length}
            </Text>
          </View>
        ) : null}
      </View>

      <Modal
        animationType="fade"
        onRequestClose={() => setVisible(false)}
        presentationStyle="overFullScreen"
        statusBarTranslucent
        transparent
        visible={visible}
      >
        <View style={styles.overlay}>
          <Pressable
            accessibilityLabel="Close notifications"
            accessibilityRole="button"
            onPress={() => setVisible(false)}
            style={StyleSheet.absoluteFill}
          />
          <SafeAreaView edges={['top', 'bottom']} pointerEvents="box-none" style={styles.safeArea}>
            <View accessibilityViewIsModal style={styles.sheet}>
              <View style={styles.header}>
                <View style={styles.headingCopy}>
                  <Text accessibilityRole="header" style={styles.title}>Notifications</Text>
                  <Text style={styles.subtitle}>
                    {activity.length === 1 ? '1 app event' : `${activity.length} app events`}
                  </Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  hitSlop={8}
                  onPress={() => setVisible(false)}
                  style={({ pressed }) => [styles.done, pressed && styles.pressed]}
                >
                  <Text style={styles.doneText}>Done</Text>
                </Pressable>
              </View>

              <ScrollView
                contentContainerStyle={styles.list}
                contentInsetAdjustmentBehavior="never"
                showsVerticalScrollIndicator={false}
              >
                {topGainer !== null || topLoser !== null || latestNews !== null ? (
                  <View style={styles.group}>
                    <Text style={styles.groupTitle}>LIVE MARKET</Text>
                    {topGainer !== null ? (
                      <LiveRow label="GAINER" text={topGainer} tone="positive" />
                    ) : null}
                    {topLoser !== null ? (
                      <LiveRow label="LOSER" text={topLoser} tone="negative" />
                    ) : null}
                    {latestNews !== null ? (
                      <LiveRow label="NEWS" text={latestNews.headline} tone="neutral" />
                    ) : null}
                  </View>
                ) : null}

                <View accessibilityLiveRegion="polite" style={styles.group}>
                  <Text style={styles.groupTitle}>APP ACTIVITY</Text>
                  {activity.map((item) => <ActivityRow item={item} key={item.id} />)}
                  {activity.length === 0 ? (
                    <Text style={styles.empty}>
                      Trade, funding, withdrawal, and wallet events will appear here.
                    </Text>
                  ) : null}
                </View>
              </ScrollView>
            </View>
          </SafeAreaView>
        </View>
      </Modal>
    </>
  );
}

function BellIcon() {
  return (
    <Svg height={22} viewBox="0 0 24 24" width={22}>
      <Path
        d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 8h18c0-1-3-1-3-8ZM10 21h4"
        fill="none"
        stroke={colors.textPrimary}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.9}
      />
    </Svg>
  );
}

function ActivityRow({ item }: { readonly item: InAppNotification }) {
  return (
    <View style={styles.row}>
      <View style={styles.rowHeader}>
        <Text style={[
          styles.label,
          item.outcome === 'success' && styles.positive,
          item.outcome === 'error' && styles.negative,
        ]}>{item.kind.toUpperCase()}</Text>
        <Text style={styles.time}>{formatTime(item.createdAtMs)}</Text>
      </View>
      <Text style={styles.text}>{item.title}</Text>
      <Text style={styles.detail}>{item.message}</Text>
    </View>
  );
}

function LiveRow({ label, text, tone }: {
  readonly label: string;
  readonly text: string;
  readonly tone: 'positive' | 'negative' | 'neutral';
}) {
  return (
    <View style={styles.row}>
      <Text style={[
        styles.label,
        tone === 'positive' && styles.positive,
        tone === 'negative' && styles.negative,
      ]}>{label}</Text>
      <Text numberOfLines={3} style={styles.text}>{text}</Text>
    </View>
  );
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
  trigger: { position: 'relative' },
  badge: {
    position: 'absolute',
    top: -3,
    right: -5,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.pill,
    borderWidth: 2,
    borderColor: colors.background,
    backgroundColor: colors.accent,
  },
  badgeText: { ...typography.eyebrow, fontSize: 9, color: colors.onAccent },
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(5, 5, 9, 0.72)',
  },
  safeArea: { width: '100%', maxHeight: '88%' },
  sheet: {
    width: '100%',
    maxWidth: layout.maxContentWidth,
    maxHeight: '100%',
    alignSelf: 'center',
    overflow: 'hidden',
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: 0,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
  },
  header: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingHorizontal: layout.screenPadding,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  headingCopy: { flex: 1 },
  title: { ...typography.heading, color: colors.textPrimary },
  subtitle: { ...typography.caption, color: colors.textMuted },
  done: { minHeight: 44, justifyContent: 'center', paddingHorizontal: spacing.xs },
  doneText: { ...typography.label, color: colors.accentSoft },
  pressed: { opacity: 0.6 },
  list: { padding: layout.screenPadding, paddingBottom: spacing.xxl, gap: spacing.lg },
  group: { gap: spacing.xxs },
  groupTitle: { ...typography.eyebrow, color: colors.textMuted },
  row: {
    gap: 2,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowHeader: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm },
  label: { ...typography.eyebrow, color: colors.textMuted },
  time: { ...typography.caption, color: colors.textMuted },
  text: { ...typography.bodyCompact, color: colors.textPrimary },
  detail: { ...typography.caption, color: colors.textSecondary },
  empty: { ...typography.bodyCompact, paddingVertical: spacing.md, color: colors.textMuted },
  positive: { color: colors.positive },
  negative: { color: colors.negative },
});
