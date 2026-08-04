import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { EmptyState } from '@/components/feedback/EmptyState';
import { AppScreen } from '@/components/layout/AppScreen';
import { colors, layout, spacing, typography } from '@/theme/tokens';

/**
 * Authenticated home. Intentionally quiet: it shows a real, honest state (no
 * open positions yet) rather than fabricated balances or activity, and points
 * to the one next action once trading is wired up.
 */
export function HomeScreen() {
  const router = useRouter();

  return (
    <AppScreen>
      <View style={styles.container}>
        <View style={styles.header}>
          <Text accessibilityRole="header" style={styles.title}>
            Home
          </Text>
          <Text style={styles.subtitle}>Your trading overview</Text>
        </View>

        <EmptyState
          action={{
            label: 'Explore markets',
            onPress: () => router.navigate('/trade'),
          }}
          message="Your open positions and recent orders will appear here once you place your first trade."
          title="No open positions"
        />
      </View>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    width: '100%',
    maxWidth: layout.maxContentWidth,
    alignSelf: 'center',
    paddingHorizontal: layout.screenPadding,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl,
  },
  header: {
    paddingVertical: spacing.sm,
  },
  title: {
    ...typography.title,
    color: colors.textPrimary,
  },
  subtitle: {
    ...typography.bodyCompact,
    marginTop: spacing.xxs,
    color: colors.textSecondary,
  },
});
