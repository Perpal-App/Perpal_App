import type { ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors } from '@/theme/tokens';

type AppScreenProps = {
  children: ReactNode;
  background?: ReactNode;
  contentContainerStyle?: StyleProp<ViewStyle>;
};

/**
 * Safe-area-aware screen surface with a scroll fallback for small devices and
 * large accessibility text. Decorative backgrounds sit outside the scroll
 * content and never receive touches or screen-reader focus.
 */
export function AppScreen({
  children,
  background,
  contentContainerStyle,
}: AppScreenProps) {
  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'right', 'bottom', 'left']}>
      {background ? (
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          pointerEvents="none"
          style={StyleSheet.absoluteFill}
        >
          {background}
        </View>
      ) : null}

      {/* Keyboard avoidance is centralized here alongside the safe area: when
          the keyboard opens, the scroll area shrinks so flex-based screen
          layouts recompute and lift their content clear of the keypad. */}
      <KeyboardAvoidingView behavior="padding" style={styles.keyboardAvoider}>
        <ScrollView
          bounces={false}
          contentContainerStyle={[styles.content, contentContainerStyle]}
          contentInsetAdjustmentBehavior="never"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          style={styles.scroll}
        >
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  keyboardAvoider: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
  },
});
