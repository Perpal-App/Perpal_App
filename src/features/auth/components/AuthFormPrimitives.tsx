import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';

import { colors, spacing, typography } from '@/theme/tokens';

type AuthFormScrollProps = {
  children: ReactNode;
};

/** Scroll fallback for the fixed-height auth card and accessibility text. */
export function AuthFormScroll({ children }: AuthFormScrollProps) {
  return (
    <ScrollView
      contentContainerStyle={styles.formScroll}
      keyboardShouldPersistTaps="handled"
      nestedScrollEnabled
      showsVerticalScrollIndicator={false}
    >
      {children}
    </ScrollView>
  );
}

type AuthTextActionProps = {
  disabled: boolean;
  label: string;
  onPress: () => void;
};

/** Static text action; intentionally has no press or entrance animation. */
export function AuthTextAction({
  disabled,
  label,
  onPress,
}: AuthTextActionProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={styles.textAction}
    >
      <Text style={styles.textActionLabel}>{label}</Text>
    </Pressable>
  );
}

export function AuthErrorMessage({ message }: { message: string }) {
  return (
    <Text
      accessibilityLiveRegion="polite"
      accessibilityRole="alert"
      style={styles.error}
    >
      {message}
    </Text>
  );
}

const styles = StyleSheet.create({
  formScroll: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  textAction: {
    minHeight: 36,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  textActionLabel: {
    ...typography.label,
    color: colors.onLight,
  },
  error: {
    ...typography.bodyCompact,
    color: colors.onLight,
    fontWeight: '600',
    textAlign: 'center',
  },
});
