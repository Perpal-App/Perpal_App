import { LinearGradient } from 'expo-linear-gradient';
import type { ReactNode } from 'react';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { colors, gradients, radii } from '@/theme/tokens';

/**
 * The ticket's one surface material: `surfaceRaise` under a hairline rim.
 *
 * The same object the portfolio's position cards and the notification rows are cut from — a lit top
 * edge running down to a deeper base — so the ticket's cards read as the app's own chrome rather than
 * as a new kind of card.
 *
 * The ramp never changes at runtime. That matters on Android, where `expo-linear-gradient` can be left
 * drawing nothing when a live gradient's stops are swapped; state such as focus or an error is shown on
 * the rim instead.
 */
export function TicketPanel({
  children,
  style,
}: {
  readonly children: ReactNode;
  readonly style?: StyleProp<ViewStyle>;
}) {
  return (
    <LinearGradient
      colors={gradients.surfaceRaise.colors}
      end={{ x: 0.5, y: 1 }}
      locations={gradients.surfaceRaise.locations}
      start={{ x: 0.5, y: 0 }}
      style={[styles.panel, style]}
    >
      {children}
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  panel: {
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderCurve: 'continuous',
  },
});
