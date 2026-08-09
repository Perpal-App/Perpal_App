import { StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { PressableScale } from '@/components/ui/PressableScale';
import {
  markInAppNotificationRead,
  type InAppNotification,
  type InAppNotificationKind,
} from '@/storage/inAppNotifications';
import { colors, radii, spacing, typography } from '@/theme/tokens';

const ICON_TARGET = 38;
const ICON_GLYPH = 20;
const CHECK_TARGET = 30;
const CHECK_GLYPH = 15;
const STROKE = 1.8;

/**
 * One glyph per kind of event, which is what replaced the coloured dot.
 *
 * A dot could only ever say "something happened, and it went well or badly" — the kind had to be
 * spelled out in a text tag beside it, and five hues down a column read as decoration rather than
 * as information. A glyph names the event instead, so the row identifies itself before a single
 * word is read, and the colour budget goes back to the one case that genuinely needs it.
 *
 * Money in and money out are the same arrow mirrored across the same baseline, deliberately: they
 * are one operation in two directions, and drawing them as unrelated shapes would hide that.
 */
const GLYPHS: Readonly<Record<InAppNotificationKind, string>> = {
  trade: 'M4.2 15.6 9.2 10.6l3 3 6.4-6.4M14.6 7.2h4.2v4.2',
  funding: 'M12 4.8v9.4M8.5 10.7 12 14.2l3.5-3.5M5 19.2h14',
  withdrawal: 'M12 14.2V4.8M8.5 8.3 12 4.8l3.5 3.5M5 19.2h14',
  wallet:
    'M4.4 8.8A2.6 2.6 0 0 1 7 6.2h10A2.6 2.6 0 0 1 19.6 8.8v6.4A2.6 2.6 0 0 1 17 17.8H7a2.6 2.6 0 0 1-2.6-2.6ZM15.4 12.3h2.6',
};

/**
 * One logged event: what it was, what it said, when, and whether it has been acknowledged.
 *
 * Read state is carried by weight and by the presence of the tick, never by colour. Colour on this
 * row means exactly one thing — the event failed — so a red glyph is always worth looking at
 * instead of being one more tint in a palette.
 */
export function NotificationRow({ item, last }: {
  readonly item: InAppNotification;
  readonly last: boolean;
}) {
  const unread = item.readAtMs === null;

  return (
    <View style={[styles.row, last && styles.rowLast]}>
      <View style={styles.icon}>
        <Svg height={ICON_GLYPH} viewBox="0 0 24 24" width={ICON_GLYPH}>
          <Path
            d={GLYPHS[item.kind]}
            fill="none"
            stroke={item.outcome === 'error' ? colors.negative : colors.textSecondary}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={STROKE}
          />
        </Svg>
      </View>

      <View style={styles.body}>
        <Text numberOfLines={1} style={[styles.title, !unread && styles.titleRead]}>
          {item.title}
        </Text>
        <Text numberOfLines={2} style={styles.message}>{item.message}</Text>
        <Text style={styles.time}>{formatTime(item.createdAtMs)}</Text>
      </View>

      {unread ? (
        <PressableScale
          accessibilityHint="Marks this event as read"
          accessibilityLabel={`Mark ${item.title} as read`}
          accessibilityRole="button"
          hitSlop={8}
          onPress={() => markInAppNotificationRead(item.id)}
          style={styles.check}
        >
          <Svg height={CHECK_GLYPH} viewBox="0 0 24 24" width={CHECK_GLYPH}>
            <Path
              d="M5 12.6 9.7 17.3 19 8"
              fill="none"
              stroke={colors.accentSoft}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2.4}
            />
          </Svg>
        </PressableScale>
      ) : null}
    </View>
  );
}

/**
 * Time only, because the row already sits under a day heading. Printing the date again on every
 * row was the heading's job done twice.
 */
function formatTime(timeMs: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(timeMs));
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    padding: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  // The card's own edge closes the group, so the last row must not draw a second line inside it.
  rowLast: { borderBottomWidth: 0 },
  // A rounded square rather than a circle: the app's circles are all controls — the bell, the
  // avatar, the close button — and a round container here would invite a tap that does nothing.
  icon: {
    width: ICON_TARGET,
    height: ICON_TARGET,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.sm,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surfaceElevated,
  },
  body: { flex: 1, minWidth: 0, gap: 2 },
  title: { ...typography.label, color: colors.textPrimary },
  // Read rows step back rather than disappearing. Still legible, clearly already dealt with.
  titleRead: { color: colors.textSecondary },
  message: { ...typography.caption, color: colors.textSecondary },
  time: { ...typography.caption, marginTop: 2, color: colors.textMuted },
  check: {
    width: CHECK_TARGET,
    height: CHECK_TARGET,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassEdge,
    backgroundColor: colors.glassTint,
  },
});
