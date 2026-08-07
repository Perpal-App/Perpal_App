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
  /** Applies to the built-in scroll container, so it is ignored when `scroll` is false. */
  contentContainerStyle?: StyleProp<ViewStyle>;
  /**
   * Set false when the screen brings its own scroller — a virtualized list
   * cannot live inside another vertical ScrollView. The safe area and keyboard
   * avoidance stay here either way, so a screen never reads insets itself.
   */
  scroll?: boolean;
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
  scroll = true,
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
        {scroll ? (
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
        ) : (
          children
        )}
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
