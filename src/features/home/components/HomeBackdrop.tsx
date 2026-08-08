import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet } from 'react-native';

import { gradients } from '@/theme/tokens';

/**
 * The home screen's ambience: one gradient, anchored to the top of the viewport.
 *
 * Deliberately a single ramp where onboarding stacks three. That screen is a composition and can
 * afford edge tints crossing each other; this one is a wall of figures, and every additional
 * layer is something for a number to be read against.
 *
 * Mounted through `AppScreen`'s `background`, so it sits outside the scroller and outside the
 * safe area: it stays put while the content moves over it, which is what makes it read as light
 * in the room rather than as the first item in a list.
 */
export function HomeBackdrop() {
  return (
    <LinearGradient
      colors={gradients.homeField.colors}
      end={{ x: 0.5, y: 1 }}
      locations={gradients.homeField.locations}
      start={{ x: 0.5, y: 0 }}
      style={StyleSheet.absoluteFill}
    />
  );
}
