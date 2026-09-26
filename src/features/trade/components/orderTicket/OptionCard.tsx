import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, type ReactElement, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { MorphView } from '@/components/motion/MorphView';
import { PressableScale } from '@/components/ui/PressableScale';
import { colors, gradients, motion, radii, spacing, typography } from '@/theme/tokens';

/** What the card hands its glyph, so every option's mark is drawn at one size and in one ink. */
export type OptionGlyph = { readonly color: string; readonly size: number };

/**
 * The mark on its own, with nothing drawn around it. A point up from a row's usual 23 now that it no longer
 * sits in a disc: bare, it has to hold the row's left edge by itself.
 */
const GLYPH = 24;
const CHEVRON = 16;

/**
 * Ceiling on the OS text size in the header. It still scales, but a title, a subtitle and a value share
 * one line's width, and uncapped at 2x the value is pushed out of the card entirely.
 *
 * Exported for a drawn `value`, which sets its own text and has to stop at the same size as the header
 * around it.
 */
export const OPTION_TEXT_SCALE = 1.3;

/**
 * One of the ticket's options, which opens where it stands.
 *
 * Collapsed, it is a row: a bare mark, what the option is, what it is currently doing, a value and a chevron.
 * Tapped, the same card becomes the editor — nothing is pushed over it and nothing slides in from
 * elsewhere. The header stays exactly where it was, its chevron turns to point at what opened, and the
 * body grows out beneath it while the cards around it spring to their new places. Tapping the header again
 * folds it back.
 *
 * The morph is the card's own frame, sprung by `layoutMorph`, with the body clipped to it as it grows — so
 * the editor is uncovered by the card opening rather than fading in on top of a card that has already
 * jumped to size. Everything starts on the frame of the tap.
 *
 * `fill` lets an open card take whatever height the ticket has spare, with its body centred in it, so an
 * editor that needs no keypad occupies the keypad's room rather than leaving it empty.
 *
 * The value on the right is what the option currently comes to. A string is set as the header's figure,
 * like leverage's `5×`; anything else is drawn as given, fading in and out as it comes and goes, and is
 * spoken as `valueLabel`. Either way it gives way to the editor while the card is open.
 */
export function OptionCard({
  accessibilityHint,
  children,
  expanded,
  fill = false,
  icon,
  onToggle,
  subtitle,
  title,
  value,
  valueLabel,
}: {
  readonly accessibilityHint: string;
  /** The editor, rendered only while the card is open. */
  readonly children: ReactNode;
  readonly expanded: boolean;
  readonly fill?: boolean;
  /**
   * Draws the option's mark. The card decides the size and the ink and the caller decides the glyph, so an
   * icon-font glyph and a bundled SVG sit side by side identically.
   */
  readonly icon: (glyph: OptionGlyph) => ReactNode;
  readonly onToggle: () => void;
  readonly subtitle: string;
  readonly title: string;
  readonly value?: string | ReactElement | undefined;
  /** How a drawn `value` is spoken. */
  readonly valueLabel?: string;
}) {
  const reduceMotion = useReducedMotion();
  const open = useSharedValue(expanded ? 1 : 0);

  useEffect(() => {
    open.set(reduceMotion ? (expanded ? 1 : 0) : withSpring(expanded ? 1 : 0, motion.spring));
  }, [expanded, open, reduceMotion]);

  // A quarter turn, on the same spring as everything else — it carries one soft overshoot as it lands.
  const chevronStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${open.value * 90}deg` }] }));
  // The header's value gives way to the editor's own, larger one; clamped because the spring overshoots.
  const valueStyle = useAnimatedStyle(() => ({ opacity: Math.min(Math.max(1 - open.value, 0), 1) }));

  const textValue = typeof value === 'string' ? value : null;
  const drawnValue = value === undefined || typeof value === 'string' ? null : value;
  const spokenValue = textValue ?? (drawnValue === null ? undefined : valueLabel);

  return (
    <MorphView style={[styles.card, fill && expanded && styles.fill]}>
      {/* Laid out at the card's final size and clipped to its springing frame. When the card shrinks, the
          strip it has not reached yet shows the card's own colour, which is the ramp's deepest stop. */}
      <LinearGradient
        colors={gradients.surfaceRaise.colors}
        end={{ x: 0.5, y: 1 }}
        locations={gradients.surfaceRaise.locations}
        pointerEvents="none"
        start={{ x: 0.5, y: 0 }}
        style={StyleSheet.absoluteFill}
      />
      <PressableScale
        accessibilityHint={expanded ? `Closes ${title.toLowerCase()}` : accessibilityHint}
        accessibilityLabel={[title, spokenValue, subtitle].filter(Boolean).join(', ')}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={onToggle}
        // Barely any travel: a full-width row scaling by the app's usual 4% moves its edges several points
        // against the card around it, and reads as the surface flexing.
        pressedScale={0.985}
        style={styles.header}
      >
        {/* The mark alone — no disc, no rim. It is decorative: the header's own label names the option. */}
        {icon({ color: colors.textPrimary, size: GLYPH })}
        <View style={styles.copy}>
          <Text maxFontSizeMultiplier={OPTION_TEXT_SCALE} numberOfLines={1} style={styles.title}>{title}</Text>
          <Text maxFontSizeMultiplier={OPTION_TEXT_SCALE} numberOfLines={1} style={styles.subtitle}>
            {subtitle}
          </Text>
        </View>
        {textValue === null ? null : (
          <Animated.Text
            maxFontSizeMultiplier={OPTION_TEXT_SCALE}
            numberOfLines={1}
            style={[styles.value, valueStyle]}
          >
            {textValue}
          </Animated.Text>
        )}
        {/* Two layers: the outer one fades the value in and out as it comes and goes, and springs its frame
            as it grows or shrinks; the inner one hides it while the card is open. Kept apart so the fade and
            the open state never write the same opacity. */}
        {drawnValue === null ? null : (
          <MorphView fadeIn fadeOut style={styles.drawnValue}>
            <Animated.View style={valueStyle}>{drawnValue}</Animated.View>
          </MorphView>
        )}
        <Animated.View style={chevronStyle}>
          <Ionicons color={colors.textMuted} name="chevron-forward" size={CHEVRON} />
        </Animated.View>
      </PressableScale>

      {/* Mounted and unmounted rather than folded: the body is clipped by the card's own frame, so however it
          arrives or leaves, it can only ever be seen inside the card that is opening or closing around it. */}
      {expanded ? (
        <MorphView fadeIn fadeOut style={[styles.body, fill && styles.bodyFill]}>{children}</MorphView>
      ) : null}
    </MorphView>
  );
}

const styles = StyleSheet.create({
  // The card is the animated frame, so it carries the rim and the clip itself; a rim on an inner panel
  // would be cut off at the bottom for as long as the frame was still catching up with it.
  card: {
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderCurve: 'continuous',
    backgroundColor: gradients.surfaceRaise.colors[1],
  },
  fill: { flexGrow: 1 },
  header: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  // `flex: 1` so the copy owns the leftover width and the value sits hard against the chevron.
  copy: { flex: 1, minWidth: 0, gap: 1 },
  title: { ...typography.rowLabel, color: colors.textPrimary },
  subtitle: { ...typography.caption, color: colors.textMuted },
  value: { ...typography.label, flexShrink: 0, color: colors.textPrimary },
  drawnValue: { flexShrink: 0 },
  body: { gap: spacing.md, paddingHorizontal: spacing.md, paddingBottom: spacing.md },
  bodyFill: { flexGrow: 1, justifyContent: 'center' },
});
