import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import type { KeypadKey as Key } from '@/features/trade/components/orderTicket/keypadEntry';
import { colors, motion, typography } from '@/theme/tokens';

/**
 * The press disc. Fixed rather than following the row, which can be anything from its 48pt floor to its
 * ceiling: a disc that grew with the row would read as a different key on every phone. On the shortest
 * rows it reaches a hair past the key's edge, which is fine for something only drawn under a finger.
 */
const HALO = 54;
const DELETE_GLYPH = 24;
/** Holding delete clears the figure. Long enough that a slow single tap never reaches it. */
const CLEAR_DELAY_MS = 450;

const SPOKEN: Readonly<Partial<Record<Key, string>>> = {
  '.': 'Decimal point',
  delete: 'Delete',
};

/**
 * One key: a glyph, and a soft disc behind it while it is held.
 *
 * The disc is the whole press feedback, drawn the way a phone's own keypad draws it — it lands almost
 * inside the touch and lingers a moment after — and it is scale and opacity only, on the UI thread, so a
 * fast run of taps never waits on JavaScript to show. Under reduce motion it still appears and
 * disappears, without the growth.
 *
 * `onPress` rather than on touch-down, deliberately: the keypad sits in a scrolling sheet, and a key
 * that fired on contact would type a digit every time a scroll happened to start on it.
 */
export function KeypadKey({
  keyValue,
  onLongPress,
  onPress,
}: {
  readonly keyValue: Key;
  readonly onLongPress?: () => void;
  readonly onPress: (key: Key) => void;
}) {
  const reduceMotion = useReducedMotion();
  const held = useSharedValue(0);

  const press = (to: 0 | 1) => {
    held.set(withTiming(to, {
      duration: to === 1 ? motion.keypad.pressInMs : motion.keypad.releaseMs,
      easing: Easing.out(Easing.cubic),
    }));
  };

  const haloStyle = useAnimatedStyle(() => ({
    opacity: held.value,
    transform: [{
      scale: reduceMotion ? 1 : motion.keypad.haloFrom + (1 - motion.keypad.haloFrom) * held.value,
    }],
  }));

  return (
    <Pressable
      accessibilityHint={keyValue === 'delete' ? 'Hold to clear the amount' : undefined}
      accessibilityLabel={SPOKEN[keyValue] ?? keyValue}
      accessibilityRole="keyboardkey"
      delayLongPress={CLEAR_DELAY_MS}
      onLongPress={onLongPress}
      onPress={() => onPress(keyValue)}
      onPressIn={() => press(1)}
      onPressOut={() => press(0)}
      style={styles.key}
    >
      <View style={styles.face}>
        <Animated.View pointerEvents="none" style={[styles.halo, haloStyle]} />
        {keyValue === 'delete' ? (
          <Ionicons color={colors.textPrimary} name="backspace-outline" size={DELETE_GLYPH} />
        ) : (
          <Text maxFontSizeMultiplier={1.2} style={styles.digit}>{keyValue}</Text>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // Its width from the column and its height from the row, so the whole cell is the touch target at any
  // size the keypad has been given. The height is `AmountKeypad`'s decision, not the key's.
  key: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  // A fixed square for the glyph and its disc, so the disc is a circle centred on the glyph whatever
  // size the cell comes out.
  face: { width: HALO, height: HALO, alignItems: 'center', justifyContent: 'center' },
  halo: {
    position: 'absolute',
    inset: 0,
    borderRadius: HALO / 2,
    backgroundColor: colors.border,
  },
  digit: { ...typography.keypad, color: colors.textPrimary },
});
