import { StyleSheet, Text, View } from 'react-native';

import { AppScreen } from '@/components/layout/AppScreen';
import type { ConfigIssue } from '@/config/appConfig';
import { colors, layout, radii, spacing, typography } from '@/theme/tokens';

type ConfigErrorScreenProps = {
  issues: readonly ConfigIssue[];
};

/**
 * Shown when build configuration is missing or incoherent.
 *
 * The app fails closed rather than starting with a partial config, because a
 * half-configured build could otherwise dial the wrong cluster. The exact
 * variable names are listed so the fix is obvious without reading source.
 *
 * This is a developer-facing screen and only reachable on a misconfigured build.
 */
export function ConfigErrorScreen({ issues }: ConfigErrorScreenProps) {
  return (
    <AppScreen>
      <View accessibilityRole="alert" style={styles.content}>
        <Text style={styles.title}>Configuration incomplete</Text>
        <Text style={styles.message}>
          This build cannot start until the following values are set. Copy
          `.env.example` to `.env.mainnet`, fill it in, then
          rebuild.
        </Text>

        <View style={styles.list}>
          {issues.map((issue) => (
            <View key={issue.variable} style={styles.row}>
              <Text selectable style={styles.variable}>
                {issue.variable}
              </Text>
              <Text style={styles.problem}>{issue.problem}</Text>
            </View>
          ))}
        </View>
      </View>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    width: '100%',
    maxWidth: layout.maxContentWidth,
    alignSelf: 'center',
    justifyContent: 'center',
    paddingHorizontal: layout.screenPadding,
    gap: spacing.md,
  },
  title: {
    ...typography.heading,
    color: colors.textPrimary,
  },
  message: {
    ...typography.bodyCompact,
    color: colors.textSecondary,
  },
  list: {
    marginTop: spacing.sm,
    gap: spacing.sm,
  },
  row: {
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    gap: spacing.xs,
  },
  variable: {
    ...typography.bodyCompact,
    color: colors.accentSoft,
  },
  problem: {
    ...typography.bodyCompact,
    color: colors.textMuted,
  },
});
