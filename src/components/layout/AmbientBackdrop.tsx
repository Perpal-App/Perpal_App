import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet } from 'react-native';

import { gradients } from '@/theme/tokens';

/**
 * The app's ambience for a personal surface: one violet gradient, anchored to the top of the
 * viewport and resolved into the page before the content below it starts.
 *
 * Deliberately a single ramp where onboarding stacks three. That screen is a composition and can
 * afford edge tints crossing each other; these are walls of figures, and every additional layer
 * is something for a number to be read against.
 *
 * Pass it to `AppScreen`'s `background`, which mounts it outside the scroller and outside the
 * safe area: it stays put while the content moves over it, which is what makes it read as light
 * in the room rather than as the first item in a list.
 *
 * Home and Profile both use it, and the pairing is the point — those are the two screens about
 * the reader. Markets and market detail stay flat, because a gradient behind a price column is
 * one more surface a number has to survive.
 */
export function AmbientBackdrop() {
  return (
    <LinearGradient
      colors={gradients.ambientField.colors}
      end={{ x: 0.5, y: 1 }}
      locations={gradients.ambientField.locations}
      start={{ x: 0.5, y: 0 }}
      style={StyleSheet.absoluteFill}
    />
  );
}
