import { StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { NotificationReadButton } from '@/features/home/components/NotificationReadButton';
import {
  markInAppNotificationRead,
  type InAppNotification,
  type InAppNotificationKind,
} from '@/storage/inAppNotifications';
import { colors, radii, spacing, typography } from '@/theme/tokens';

/**
 * The card's corner, and the icon tile's, held in the concentric relationship that keeps a nested
 * corner looking like the same corner.
 *
 * A rounded box inside a rounded box only reads as one object when the inner radius is the outer
 * radius less the space between them. Set the tile to a token instead and the two curves fight:
 * too large and the tile bulges out of the corner it sits in, too small and it looks square beside
 * it. Derived rather than written down so it stays true if the card's radius or its inset moves.
 */
const CARD_RADIUS = radii.lg;
const TILE_RADIUS = CARD_RADIUS - spacing.md;

/**
 * The kind tile, sized to the two lines it stands beside — the title, and the first line of the
 * message — rather than picked by eye.
 *
 * That is the relationship that makes a leading mark read as belonging to its text: it spans the
 * part of the row carrying the meaning and stops before the timestamp, which is metadata. Both
 * lines lead at 21, so the sum is exact and there is no gap between them to account for.
 */
const TILE = typography.label.lineHeight + typography.bodyCompact.lineHeight;

/**
 * Render size of the glyph's 24-unit box inside the tile.
 *
 * The glyphs below draw on a 3–21 band of that box — an 18-unit ink grid with even 3-unit padding,
 * the grid Feather and Lucide use — so the visible mark is three quarters of this number. That
 * accounting is the whole reason the icons read as an afterthought before: a 20pt box holding paths
 * that inked 14 of 24 units put roughly 12pt of visible glyph inside a 37pt tile, under a third of
 * it. Raising only the box would not have fixed it while the paths stayed loose inside their own
 * grid, and each of the four inked a different amount, so the set was unevenly weighted too.
 */
const TILE_GLYPH = Math.round(TILE * 0.64);

/**
 * Optical top for the tile and the tick.
 *
 * A text line box is taller than the letters inside it — `label` leads at 21 for a 14pt face — so
 * the title's capitals begin about 3.5pt below the top of its line. A tile has no such internal
 * padding, so setting it flush with the text block's top edge lands it visibly higher than the
 * title it is meant to sit beside. Half the title's leading lines it up with the caps instead of
 * with the invisible box around them, and putting the tick on the same offset keeps the row's two
 * fixed-size objects level with each other.
 */
const OPTICAL_TOP = (typography.label.lineHeight - typography.label.fontSize) / 2;

const STROKE = 1.8;

/**
 * Ceiling on the OS text size for this row.
 *
 * The row scales with the reader's setting rather than ignoring it, but not without limit: past
 * roughly a third larger the title and the timestamp stop sharing a card with a fixed-size tile and
 * a tap target without one of them being pushed out. Every line here wraps instead of truncating at
 * one, so growth costs height, which the sheet can scroll, rather than costing words.
 */
const MAX_TEXT_SCALE = 1.35;

/**
 * One glyph per kind of event, which is what replaced the coloured dot.
 *
 * A dot could only ever say "something happened, and it went well or badly" — the kind had to be
 * spelled out in a text tag beside it, and five hues down a column read as decoration rather than
 * as information. A glyph names the event instead, so the row identifies itself before a single
 * word is read, and the colour budget goes back to the one case that genuinely needs it.
 *
 * All four are redrawn to one ink grid: 3 to 21 on both axes of the 24-unit box, so a stroke ends
 * where the next glyph's stroke ends and the four carry the same visual weight in the column. They
 * did not before — the wallet inked 15 units wide, the trend arrow 8 tall — which read as four
 * icons at four different sizes rather than one set.
 *
 * The trend line is the one that stays short of the full height, and has to: pushed to 18 units
 * tall its slope becomes a cliff and it stops reading as a market moving.
 *
 * Money in and money out are still the same arrow mirrored across the same baseline, deliberately:
 * they are one operation in two directions, and drawing them as unrelated shapes would hide that.
 */
const GLYPHS: Readonly<Record<InAppNotificationKind, string>> = {
  trade: 'M3.5 19 10 12.5l3.75 3.75L20.5 5.5M14.5 5.5h6v6',
  funding: 'M12 3.5V14M7.5 9.5 12 14l4.5-4.5M4 19.5h16',
  withdrawal: 'M12 14V3.5M7.5 8 12 3.5l4.5 4.5M4 19.5h16',
  wallet:
    'M3.5 8A3.5 3.5 0 0 1 7 4.5h10A3.5 3.5 0 0 1 20.5 8v8a3.5 3.5 0 0 1-3.5 3.5H7A3.5 3.5 0 0 1 3.5 16Z' +
    'M15.75 12h4.75',
};

/**
 * One logged event: what it was, what it said, when, and whether it has been acknowledged.
 *
 * Its own rounded card, rather than a band inside a taller one divided by hairlines. Dividers make
 * a run of events read as a table, where each of these is a separate thing that happened at a
 * separate time and can be acted on by itself — and the tick that acts on it had no visible extent
 * of its own to belong to. Separating them also retires the last-child rule the group needed to
 * stop drawing a line against its own edge.
 *
 * Read state is carried by weight and by the tick's fill, never by colour. Colour on this row means
 * exactly one thing — the event failed — so a red glyph is always worth looking at instead of being
 * one more tint in a palette.
 */
export function NotificationRow({ item }: { readonly item: InAppNotification }) {
  const unread = item.readAtMs === null;

  return (
    <View style={styles.row}>
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        pointerEvents="none"
        style={styles.tile}
      >
        <Svg height={TILE_GLYPH} viewBox="0 0 24 24" width={TILE_GLYPH}>
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
        <Text
          maxFontSizeMultiplier={MAX_TEXT_SCALE}
          numberOfLines={2}
          style={[styles.title, !unread && styles.titleRead]}
        >
          {item.title}
        </Text>
        <Text maxFontSizeMultiplier={MAX_TEXT_SCALE} numberOfLines={3} style={styles.message}>
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
    borderRadius: CARD_RADIUS,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surfaceElevated,
  },
  // A rounded square rather than a circle: the app's circles are all controls — the bell, the
  // avatar, the close button, the tick across this row — and a round container here would invite a
  // tap that does nothing.
  tile: {
    width: TILE,
    height: TILE,
    marginTop: OPTICAL_TOP,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: TILE_RADIUS,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  // Carries the tick's optical offset rather than the tick doing it itself, so the button stays a
  // plain control that any row can place, and the halo keeps expanding from the disc's own centre.
  action: { marginTop: OPTICAL_TOP, flexShrink: 0 },
  // `minWidth: 0` is what lets the title wrap instead of forcing the row wider than the card: a
  // flex child's default minimum is its content, so a long unbroken title would otherwise push the
  // tick off the edge.
  //
  // No gap between the title and the message. Both lead at 1.5x, which already puts 21pt between
  // their baselines — adding a gap on top of that separated the two lines that have to be read as
  // one statement, while leaving the timestamp attached to the message it is not part of. The
  // timestamp gets the only gap in the block instead.
  body: { flex: 1, minWidth: 0 },
  title: { ...typography.label, color: colors.textPrimary },
  // Read rows step back rather than disappearing. Still legible, clearly already dealt with.
  titleRead: { color: colors.textSecondary },
  // `bodyCompact`: the same 14pt as the title, in Regular rather than SemiBold.
  //
  // It was `caption` — 12pt Medium — which put the whole hierarchy on a 2pt size step and left the
  // message the same size and weight as the timestamp, so a sentence worth reading looked like
  // metadata. Matching the title's size and letting weight and colour separate them is both easier
  // to read at a glance and the stronger contrast: 14 SemiBold white, 14 Regular secondary, 12
  // Medium muted is three unmistakable steps where 14/12/12 was two.
  message: { ...typography.bodyCompact, color: colors.textSecondary },
  time: { ...typography.caption, marginTop: spacing.xxs, color: colors.textMuted },
});
