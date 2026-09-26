import * as Haptics from 'expo-haptics';
import { Platform, StyleSheet, View } from 'react-native';

import {
  KEYPAD_ROWS,
  type KeypadKey as Key,
} from '@/features/trade/components/orderTicket/keypadEntry';
import { KeypadKey } from '@/features/trade/components/orderTicket/KeypadKey';
import { spacing } from '@/theme/tokens';

/** A row never gets shorter than the app's minimum touch target, whatever phone it is on. */
const ROW_MIN_HEIGHT = 48;
/**
 * Nor taller than this. Past it the keys stop reading as a keypad and start reading as a grid of empty
 * cells, and any height still left over is split evenly above and below the pad instead.
 */
const ROW_MAX_HEIGHT = 76;

/**
 * The ticket's number pad, in place of the system keyboard.
 *
 * It takes all the height its owner gives it. The rows share that height equally, from a 48pt floor to a
 * ceiling, so on a tall phone the space that would otherwise sit empty between the options and the keys
 * becomes room between the keys — and on a short one they hold at the floor and the sheet scrolls. The
 * height comes from flex alone; nothing here reads the screen.
 *
 * It reports keys and nothing else. Whether a key can apply is the owner's call, because only the owner
 * knows how many decimals the figure takes — so a refused key still gets its tick here, and the owner
 * answers the refusal on the figure itself.
 *
 * Haptics on iOS only, as everywhere else in the app.
 */
export function AmountKeypad({
  onClear,
  onKey,
}: {
  /** Holding delete. */
  readonly onClear: () => void;
  readonly onKey: (key: Key) => void;
}) {
  const tap = (key: Key) => {
    if (Platform.OS === 'ios') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onKey(key);
  };
  const clear = () => {
    if (Platform.OS === 'ios') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onClear();
  };

  return (
    <View style={styles.pad}>
      {KEYPAD_ROWS.map((row) => (
        <View key={row.join('')} style={styles.row}>
          {row.map((key) => (
            <KeypadKey
              key={key}
              keyValue={key}
              onPress={tap}
              {...(key === 'delete' ? { onLongPress: clear } : null)}
            />
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  // Grows into whatever its column leaves over. The inset keeps the outer keys' discs off the sheet's
  // edges, so the three columns sit inside the content rather than touching its margins.
  pad: {
    alignSelf: 'stretch',
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
  },
  // `flex: 1` on a zero basis, so the four rows split the pad's height evenly rather than by content.
  row: {
    flex: 1,
    flexDirection: 'row',
    minHeight: ROW_MIN_HEIGHT,
    maxHeight: ROW_MAX_HEIGHT,
  },
});
