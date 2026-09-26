import * as Haptics from 'expo-haptics';
import { Platform, StyleSheet, View } from 'react-native';

import {
  KEYPAD_ROWS,
  type KeypadKey as Key,
} from '@/features/trade/components/orderTicket/keypadEntry';
import { KeypadKey } from '@/features/trade/components/orderTicket/KeypadKey';

/**
 * The ticket's number pad, in place of the system keyboard.
 *
 * The system keyboard covered the figure it was typing into and resized the sheet every time it came
 * and went; this is part of the page, so the amount, the options above it and the action below it never
 * move. It also offers exactly the keys an amount can use, with nothing to switch away from.
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
  pad: { alignSelf: 'stretch' },
  row: { flexDirection: 'row' },
});
