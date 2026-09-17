import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, Text, View } from 'react-native';

import { NotificationKindIcon } from '@/features/home/components/NotificationKindIcon';
import {
  NotificationReadButton,
  NOTIFICATION_TICK_SIZE,
} from '@/features/home/components/NotificationReadButton';
import {
  markInAppNotificationRead,
  type InAppNotification,
} from '@/storage/inAppNotifications';
import { colors, gradients, radii, spacing, typography } from '@/theme/tokens';

/**
 * The mark's size, with no container around it.
 *
 * Larger than the glyph that used to sit inside the tile even though the row is now shorter, because
 * the footprint that was going to the box's padding goes to ink instead. Sized to sit inside the two
 * lines it stands beside — the title and the first line of the message, 39pt together — with enough
 * air left that a solid shape does not outweigh the type it introduces.
 */
const ICON = 30;

/**
 * Centres the mark on the title and the first message line, and puts the tick on that same axis.
 *
 * The two derive from one number so the row has a single horizontal centreline for its two marks
 * however either of them is resized. Without this the mark sat flush with the text block's top,
 * which reads high: a line box is taller than the letters in it, so type always starts lower than a
 * shape set beside it.
 */
const MARK_BAND = typography.label.lineHeight + typography.caption.lineHeight;
const ICON_TOP = (MARK_BAND - ICON) / 2;

/**
 * Ceiling on the OS text size for this row.
 *
 * The row scales with the reader's setting rather than ignoring it, but not without limit: past
 * roughly a third larger the type stops sharing a card with a fixed-size mark and a tap target
 * without one of them being pushed out. Every line wraps instead of truncating at one, so growth
 * costs height, which the sheet can scroll, rather than costing words.
 */
const MAX_TEXT_SCALE = 1.35;

/**
 * One logged event: what it was, what it said, when, and whether it has been acknowledged.
 *
 * Built on the same material as the order buttons on the market detail screen — `surfaceRaise` run
 * top to bottom under a 1pt rim in `border` — rather than a flat fill. That ramp is what gives those
 * controls their dimension, and it does the same here: the card reads as a raised surface catching
 * light instead of a lighter rectangle painted on the sheet. Clipped so the ramp takes the corner.
 *
 * Its own card, rather than a band inside a taller one divided by hairlines. Dividers make a run of
 * events read as a table, where each of these is a separate thing that happened at a separate time
 * and can be acted on by itself.
 *
 * Read state is carried by weight and by the tick's fill. Colour belongs to the mark, where it says
 * how the event went, and is never spent on the text.
 */
export function NotificationRow({ item }: { readonly item: InAppNotification }) {
  const unread = item.readAtMs === null;

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
        <NotificationKindIcon kind={item.kind} outcome={item.outcome} size={ICON} />
      </View>

      <View style={styles.body}>
        <Text
          maxFontSizeMultiplier={MAX_TEXT_SCALE}
          numberOfLines={2}
          style={[styles.title, !unread && styles.titleRead]}
        >
          {item.title}
        </Text>
        <Text maxFontSizeMultiplier={MAX_TEXT_SCALE} numberOfLines={2} style={styles.message}>
          {item.message}
        </Text>
        <Text maxFontSizeMultiplier={MAX_TEXT_SCALE} numberOfLines={1} style={styles.time}>
          {formatTime(item.createdAtMs)}
        </Text>
      </View>

      <View style={styles.action}>
        <NotificationReadButton
          label={item.title}
          onMarkRead={() => markInAppNotificationRead(item.id)}
          read={!unread}
        />
      </View>
    </LinearGradient>
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
  // 1pt rim rather than a hairline, matching the order buttons: at a hairline the ramp's dark base
  // and the rim resolve into one soft edge and the card loses the boundary that makes it a surface.
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
  mark: { marginTop: ICON_TOP, flexShrink: 0 },
  // Carries the tick's offset rather than the tick doing it itself, so the button stays a plain
  // control any row can place and its halo keeps expanding from the disc's own centre.
  action: { marginTop: ICON_TOP + (ICON - NOTIFICATION_TICK_SIZE) / 2, flexShrink: 0 },
  // `minWidth: 0` is what lets the title wrap instead of forcing the row wider than the card: a
  // flex child's default minimum is its content, so a long unbroken title would otherwise push the
  // tick off the edge.
  //
  // No gap between the title and the message. `caption` leads at 18 under a title leading at 21,
  // which is already the separation those two need — an extra step on top of it pulled apart the
  // two lines that have to be read as one statement.
  body: { flex: 1, minWidth: 0 },
  title: { ...typography.label, color: colors.textPrimary },
  // Read rows step back rather than disappearing. Still legible, clearly already dealt with.
  titleRead: { color: colors.textSecondary },
  // `caption`, not `bodyCompact`. At 14pt the message matched the title's size and carried the row's
  // height with it — two lines of body text is 42pt of card before the timestamp is even placed.
  // A supporting line is meant to be scanned, not read across, so it goes back to 12 and the copy
  // that feeds it is short enough to land on one line.
  message: { ...typography.caption, color: colors.textSecondary },
  // Smallest role in the row, and the only one that gets a gap: it is metadata, not part of the
  // sentence above it. `letterSpacing` back to 0 — `eyebrow` is tracked out for all-caps headers,
  // and a tracked-out clock reads as a label rather than as a time.
  time: {
    ...typography.eyebrow,
    letterSpacing: 0,
    marginTop: spacing.xxs,
    color: colors.textMuted,
  },
});
