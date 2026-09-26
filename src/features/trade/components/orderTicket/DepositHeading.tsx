import { StyleSheet, Text, View } from 'react-native';

import { colors, interfaceType, spacing } from '@/theme/tokens';

/**
 * What the deposit form is, and why it is there.
 *
 * Tapping `Buy / Long` on an account with nothing credited opens this form instead of an order, and on
 * its own a deposit there reads like a bug — the wallet already holds USDC. The line says the one fact a
 * reader cannot infer from the screen: the venue holds margin itself, so the money has to move in, not
 * just exist.
 */
export function DepositHeading() {
  return (
    <View style={styles.heading}>
      <Text accessibilityRole="header" style={styles.title}>Deposit collateral</Text>
      <Text style={styles.note}>Pacifica holds margin in its own vault.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  heading: { gap: spacing.xxs },
  title: { ...interfaceType.title, color: colors.textPrimary },
  note: { ...interfaceType.caption, color: colors.textMuted },
});
