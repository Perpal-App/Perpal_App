import type { ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useMinimizeOnScroll } from '@/navigation/tabs/minimizeState';
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
  /**
   * Pinned under the scroll area for the life of the screen: a primary action
   * that must stay reachable whatever the content above it is doing.
   *
   * It is a sibling of the scroller rather than an overlay, so the scroll area
   * simply ends above it — content can never hide behind it and no screen has to
   * reserve padding for it. Sitting inside this component's SafeAreaView is also
   * what keeps it clear of the home indicator without reading an inset.
   */
  footer?: ReactNode;
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
  footer,
  scroll = true,
}: AppScreenProps) {
  const onScroll = useMinimizeOnScroll();

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
          <Animated.ScrollView
            bounces={false}
            contentContainerStyle={[styles.content, contentContainerStyle]}
            contentInsetAdjustmentBehavior="never"
            keyboardShouldPersistTaps="handled"
            // Scrolling down minimizes the floating tab bar. Outside the tab shell
            // the handler writes to a local value and nothing listens, so this is
            // safe on every screen.
            onScroll={onScroll}
            scrollEventThrottle={16}
            showsVerticalScrollIndicator={false}
            style={styles.scroll}
          >
            {children}
          </Animated.ScrollView>
        ) : (
          children
        )}

        {footer}
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
