import Ionicons from '@expo/vector-icons/Ionicons';
import * as Clipboard from 'expo-clipboard';
import { useEffect, useState } from 'react';
import { AccessibilityInfo, StyleSheet, Text } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { PressableScale } from '@/components/ui/PressableScale';
import { colors, motion, spacing, typography } from '@/theme/tokens';

/** Glyph size per role, so the copy mark stays proportional to the text it sits beside. */
const ICON_SIZE = { caption: 16, label: 16 } as const;
/** How long the tick holds before the copy glyph returns. */
const COPIED_HOLD_MS = 1_600;
/** Scale the tick springs up from, so the confirmation lands rather than blinks into place. */
const COPIED_FROM_SCALE = 0.4;

/**
 * Characters kept either side of the ellipsis.
 *
 * One number for every place this appears, and deliberately not a count derived from the space
 * available. Letting the address expand into whatever room a row has left sounds like it shows more
 * for free, and it does — but it also means the value reaches all the way back to its own label with
 * nothing between them, so the row reads as one long run of text instead of a name and a value. It
 * also makes the length a property of the device, so two rows on two phones crop differently.
 *
 * Six either side measures about 104pt of Poppins Medium at 12pt. That lands between the other
 * right-hand values on the settings screen — `@PerpalApp` at 78pt and `perpal.app@gmail.com` at
 * 147pt — so the address belongs to the same column rather than overflowing it, and it leaves 36pt
 * clear beside the label on the narrowest supported width and 62pt on a typical phone.
 */
const SHORT_CHARS = 6;

/**
 * A wallet address, and copying it.
 *
 * Confirmation is the icon's job alone. Swapping the address for the word "Copied" would move
 * the only thing on the row anyone came to read, and a toast would put the answer somewhere
 * other than where the tap happened — the glyph is at the finger, so that is where the
 * acknowledgement goes.
 *
 * It reverts on a timer rather than on the next interaction, because there may not be one:
 * copying an address is usually the last thing done before leaving for another app.
 */
export function CopyableAddress({
  address,
  fallback,
  maxFontSizeMultiplier,
  role = 'caption',
  subject,
  tone = 'primary',
}: {
  /** Full address, copied verbatim. `null` renders `fallback` as plain text. */
  readonly address: string | null;
  /** Stands in when there is no address yet: a status word, not an explanation. */
  readonly fallback: string;
  /**
   * Ceiling on the OS text size, for a caller whose row caps its own label.
   *
   * Set it wherever this shares a row with capped text. If the label beside this is capped and this
   * is not, a large accessibility setting grows the address while the label holds still, and since
   * the address is the side that yields it shrinks itself toward an ellipsis to make room for text
   * that is not moving. Both sides have to scale on the same ceiling or the split comes apart.
   */
  readonly maxFontSizeMultiplier?: number;
  /**
   * Type role for the address. `label` where it is the primary line of its block, `caption` where it
   * is a secondary line or a right-hand value.
   */
  readonly role?: 'caption' | 'label';
  /** Named in the accessibility label and announcement, e.g. `public wallet address`. */
  readonly subject: string;
  /**
   * How much contrast the address carries.
   *
   * `secondary` where it sits beside its own label on one row. Both would otherwise be white, and
   * two whites a few points apart in size read as a headline welded to a subheadline rather than as
   * a row with a value on it. At 9.6:1 on the app's tinted surface it is still past AAA, which is
   * the bar that matters for a string you check character by character.
   *
   * `primary` where the address owns its line and has nothing to be confused with.
   */
  readonly tone?: 'primary' | 'secondary';
}) {
  const reduceMotion = useReducedMotion();
  const [copied, setCopied] = useState(false);
  const settle = useSharedValue(1);

  useEffect(() => {
    if (!copied) return undefined;

    const timer = setTimeout(() => setCopied(false), COPIED_HOLD_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  useEffect(() => {
    if (!copied || reduceMotion) return;

    // Undersized then sprung, so the tick arrives rather than appears. Only on the way in:
    // the revert is a state nobody is watching by then.
    settle.set(COPIED_FROM_SCALE);
    settle.set(withSpring(1, motion.spring));
  }, [copied, reduceMotion, settle]);

  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: settle.value }] }));
  const textStyle = [styles[role], tone === 'secondary' && styles.secondary];

  // No disabled button when there is nothing to copy. A control that cannot act is still an
  // element a screen reader has to walk past, and the fallback is text either way.
  if (address === null) {
    return <Text numberOfLines={1} style={[textStyle, styles.absent]}>{fallback}</Text>;
  }

  const display = shortenAddress(address);

  const copy = () => {
    void Clipboard.setStringAsync(address).then(
      () => {
        setCopied(true);
        AccessibilityInfo.announceForAccessibility(`Copied ${subject}.`);
      },
      () => AccessibilityInfo.announceForAccessibility(`Could not copy ${subject}.`),
    );
  };

  return (
    <PressableScale
      accessibilityHint={`Copies the full ${subject}`}
      accessibilityLabel={`Copy ${subject}, ${display}`}
      accessibilityRole="button"
      // The whole touch target, and all of it outside layout. This used to buy its height from
      // vertical padding, which worked but made the block 26pt tall against a 23pt label — so any
      // settings row carrying an address stood 3pt taller than the rows around it, and the group read
      // as unevenly spaced. `hitSlop` does not participate in flex, so the row's height can come from
      // the text while the target stays 46pt: past the 44pt guidance, and larger than the padding gave.
      hitSlop={{ bottom: 14, left: 10, right: 10, top: 14 }}
      onPress={copy}
      style={styles.row}
    >
      <Text
        // The safety net under `SHORT_CHARS`, not the thing doing the cropping. The fixed form fits
        // every supported width at normal text size; past the 1.25x accessibility ceiling on the
        // narrowest phone it no longer does, and then the engine takes more out of the middle rather
        // than dropping the tail. The tail is the half people actually check an address by.
        ellipsizeMode="middle"
        maxFontSizeMultiplier={maxFontSizeMultiplier}
        numberOfLines={1}
        style={textStyle}
      >
        {display}
      </Text>
      <Animated.View style={[styles.mark, animatedStyle]}>
        {copied ? (
          <Ionicons color={colors.positive} name="checkmark" size={ICON_SIZE[role]} />
        ) : (
          <Ionicons color={colors.textSecondary} name="copy-outline" size={ICON_SIZE[role]} />
        )}
      </Animated.View>
    </PressableScale>
  );
}

/** Shortened for the eye, and for what a screen reader says. */
export function shortenAddress(address: string): string {
  return address.length <= SHORT_CHARS * 2
    ? address
    : `${address.slice(0, SHORT_CHARS)}…${address.slice(-SHORT_CHARS)}`;
}

const styles = StyleSheet.create({
  // No padding at all, so the block is exactly one line of text tall. That is what keeps it
  // interchangeable with the skeleton that stands in for it — both are now the type role's line
  // height, so nothing moves when the address arrives — and what keeps a settings row carrying one
  // the same height as a row that does not. The touch target comes from `hitSlop` instead.
  //
  // `flexShrink` and `minWidth` are what let the ellipsis above ever fire. A flex item's minimum
  // defaults to its content's width, so without releasing that this would hold the address's full
  // width inside a row and push its neighbour out instead of cropping itself.
  row: {
    maxWidth: '100%',
    flexShrink: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xxs,
  },
  caption: { ...typography.caption, flexShrink: 1, minWidth: 0, color: colors.textPrimary },
  label: { ...typography.label, flexShrink: 1, minWidth: 0, color: colors.textPrimary },
  secondary: { color: colors.textSecondary },
  /** Never the side that shrinks. The address gives way; the control it belongs to does not. */
  mark: { flexShrink: 0 },
  /** A status word is not data, so it never renders at full white. */
  absent: { color: colors.textMuted },
});
