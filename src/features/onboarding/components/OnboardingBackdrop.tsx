import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, View } from 'react-native';

import { gradients } from '@/theme/tokens';

/**
 * Edge-free onboarding ambience built from full-screen gradients.
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
    </View>
  );
}
