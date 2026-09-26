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
 * Row height, and the touch target: the whole cell answers, not just the glyph. The app's 48pt minimum,
 * and no more — four rows of it are most of the ticket's height budget.
 */
const KEY_HEIGHT = 48;
const HALO = 44;
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
  key: { flex: 1, height: KEY_HEIGHT, alignItems: 'center', justifyContent: 'center' },
  // A fixed square for the glyph and its disc, so the disc is a circle centred on the glyph whatever
  // width the column gives the key.
  face: { width: HALO, height: HALO, alignItems: 'center', justifyContent: 'center' },
  halo: {
    position: 'absolute',
    inset: 0,
    borderRadius: HALO / 2,
    backgroundColor: colors.border,
  },
  digit: { ...typography.keypad, color: colors.textPrimary },
});
