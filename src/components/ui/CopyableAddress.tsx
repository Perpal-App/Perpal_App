import * as Clipboard from 'expo-clipboard';
import { useEffect, useState } from 'react';
import { AccessibilityInfo, StyleSheet, Text } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';

import { PressableScale } from '@/components/ui/PressableScale';
import { colors, motion, spacing, typography } from '@/theme/tokens';

const ICON_SIZE = 16;
/** How long the tick holds before the copy glyph returns. */
const COPIED_HOLD_MS = 1_600;
/** Scale the tick springs up from, so the confirmation lands rather than blinks into place. */
const COPIED_FROM_SCALE = 0.4;

/**
 * Characters kept either side of the ellipsis, in two measures.
 *
 * Two rather than one because the rows differ by more than a little: the home header carries
 * this beside a 52pt avatar with a 48pt control across from it, while a settings row hands it
 * most of the screen's width. One rule for both meant either a truncation that ellipsised on
 * the header or one that wasted half a settings row — and a short address in a wide space is
 * the worse of the two, because checking a wallet is mostly checking the characters you can see.
 *
 * Both are symmetric, and both are chosen to fit the narrowest device the app supports without
 * ellipsising, so the shortening never depends on how wide the screen happens to be.
 */
const COMPACT_CHARS = 6;
const WIDE_CHARS = 10;

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
  role = 'caption',
  subject,
  wide = false,
}: {
  /** Full address, copied verbatim. `null` renders `fallback` as plain text. */
  readonly address: string | null;
  /** Stands in when there is no address yet: a status word, not an explanation. */
  readonly fallback: string;
  /**
   * Type role for the address. `caption` where it is a secondary line under a heading, `label`
   * where the address is the primary line of its block.
   */
  readonly role?: 'caption' | 'label';
  /** Named in the accessibility label and announcement, e.g. `public wallet address`. */
  readonly subject: string;
  /** Keeps more of the address, for a row with the width to spend on it. */
  readonly wide?: boolean;
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
  const textStyle = styles[role];

  // No disabled button when there is nothing to copy. A control that cannot act is still an
  // element a screen reader has to walk past, and the fallback is text either way.
  if (address === null) {
    return <Text numberOfLines={1} style={[textStyle, styles.absent]}>{fallback}</Text>;
  }

  const display = shortenAddress(address, wide);

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
      hitSlop={10}
      onPress={copy}
      style={styles.row}
    >
      <Text numberOfLines={1} style={textStyle}>{display}</Text>
      <Animated.View style={animatedStyle}>
        {copied ? <CheckIcon /> : <CopyIcon />}
      </Animated.View>
    </PressableScale>
  );
}

/** Shortened for the eye. Screen readers get the subject and the same shortened form. */
export function shortenAddress(address: string, wide = false): string {
  const keep = wide ? WIDE_CHARS : COMPACT_CHARS;

  return address.length <= keep * 2
    ? address
    : `${address.slice(0, keep)}…${address.slice(-keep)}`;
}

/** Confirmation only. Round caps and joins, so a 1.8pt tick does not end in two hard points. */
function CheckIcon() {
  return (
    <Svg height={ICON_SIZE} viewBox="0 0 24 24" width={ICON_SIZE}>
      <Path
        d="M5 12.6 9.7 17.3 19 8"
        fill="none"
        stroke={colors.positive}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
      />
    </Svg>
  );
}

/** Two sheets, the front one offset off the back. Rounded, so it matches the app's chrome. */
function CopyIcon() {
  return (
    <Svg height={ICON_SIZE} viewBox="0 0 24 24" width={ICON_SIZE}>
      <Path
        d="M11 9h6a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-6a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2ZM7 15a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2"
        fill="none"
        stroke={colors.textSecondary}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.8}
      />
    </Svg>
  );
}

const styles = StyleSheet.create({
  // No fill and no leading padding: the address has to line up with whatever heading sits
  // above it, and a chip's inset would hold it a few points off that edge. The vertical
  // padding stays because it is invisible and buys the touch target its height.
  row: {
    maxWidth: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xxs,
    paddingVertical: spacing.xxs,
  },
  caption: { ...typography.caption, flexShrink: 1, color: colors.textPrimary },
  label: { ...typography.label, flexShrink: 1, color: colors.textPrimary },
  /** A status word is not data, so it never renders at full white. */
  absent: { color: colors.textMuted },
});
