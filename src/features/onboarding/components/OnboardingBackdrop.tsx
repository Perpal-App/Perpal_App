import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, View } from 'react-native';

import { MarketPathGraphic } from '@/assets/svg/MarketPathGraphic';
import { gradients } from '@/theme/tokens';

/**
 * Edge-free onboarding ambience built from full-screen gradients, with the
 * themed market-path SVG aligned across the safe top area.
 */
export function OnboardingBackdrop() {
  return (
    <View style={StyleSheet.absoluteFill}>
      <LinearGradient
        colors={gradients.onboardingField.colors}
        end={{ x: 0.5, y: 1 }}
        locations={gradients.onboardingField.locations}
        start={{ x: 0.5, y: 0 }}
        style={StyleSheet.absoluteFill}
      />

      <LinearGradient
        colors={gradients.onboardingCoolEdge.colors}
        end={{ x: 0.5, y: 0.5 }}
        locations={gradients.onboardingCoolEdge.locations}
        start={{ x: 0, y: 1 }}
        style={StyleSheet.absoluteFill}
      />

      <LinearGradient
        colors={gradients.onboardingWarmEdge.colors}
        end={{ x: 0.5, y: 0.5 }}
        locations={gradients.onboardingWarmEdge.locations}
        start={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />

      <View pointerEvents="none" style={styles.marketPath}>
        <MarketPathGraphic />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  /**
   * Inset on all sides so the arrow tip and the upper badge cannot collide with
   * the status bar or run off the screen edge. The graphic uses
   * `preserveAspectRatio="meet"`, so it scales to fit inside this box.
   */
  marketPath: {
    position: 'absolute',
    top: 28,
    left: 16,
    right: 16,
    height: 124,
  },
});
