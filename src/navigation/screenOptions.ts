import { colors } from '@/theme/tokens';

/**
 * Global navigation options shared by every native-stack layout in the app.
 *
 * Defining the transition in one place keeps screen-to-screen motion identical
 * across the whole app: a single native horizontal push/pop with swipe-back
 * enabled. Route groups each mount their own Stack, so every layout spreads
 * these options rather than relying on one navigator to cascade them.
 *
 * `animation` is fixed as a literal so it satisfies the native-stack option
 * union. Individual screens can still override any field via `Stack.Screen`
 * options when a specific route needs different motion.
 */
export const globalScreenOptions = {
  headerShown: false,
  // Native push/pop feel that is consistent on both iOS and Android, plus the
  // interactive swipe-back gesture that pairs with it.
  animation: 'slide_from_right' as const,
  gestureEnabled: true,
  contentStyle: { backgroundColor: colors.background },
};
