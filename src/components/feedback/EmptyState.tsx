import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { colors, spacing, typography } from '@/theme/tokens';

type EmptyStateAction = {
  label: string;
  onPress: () => void;
  disabled?: boolean;
};

type EmptyStateProps = {
  title: string;
  message: string;
  /** Optional decorative glyph shown above the title. */
  icon?: ReactNode;
  /** Optional single primary action. */
  action?: EmptyStateAction;
};

/**
 * Centered empty / not-yet-available state. Explains what is missing and offers
 * at most one clear next action, so a screen without data still reads as
 * intentional rather than broken.
 */
export function EmptyState({ title, message, icon, action }: EmptyStateProps) {
  return (
    <View style={styles.container}>
      {icon ? (
        <View accessibilityElementsHidden pointerEvents="none" style={styles.icon}>
          {icon}
        </View>
      ) : null}

      <Text accessibilityRole="header" style={styles.title}>
        {title}
      </Text>
      <Text style={styles.message}>{message}</Text>

      {action ? (
        <View style={styles.action}>
          <Button
            disabled={action.disabled ?? false}
            label={action.label}
            onPress={action.onPress}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  icon: {
    marginBottom: spacing.md,
  },
  title: {
    ...typography.heading,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  message: {
    ...typography.bodyCompact,
    maxWidth: 320,
    marginTop: spacing.sm,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  action: {
    alignSelf: 'stretch',
    maxWidth: 280,
    marginTop: spacing.xl,
  },
});
