import { PrivyProvider } from '@privy-io/expo';
import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { AppScreen } from '@/components/layout/AppScreen';
import { readPrivyPublicConfig } from '@/config/publicEnv';
import { colors, layout, spacing, typography } from '@/theme/tokens';

type PrivyBoundaryProps = {
  children: ReactNode;
};

/**
 * The app's single Privy provider boundary.
 *
 * Privy uses SecureStore-backed persistence by default, so no custom storage is
 * supplied. Public app/client IDs are validated before mounting the SDK. A
 * misconfigured build fails closed with a useful local message instead of
 * initializing auth with placeholder identifiers.
 */
export function PrivyBoundary({ children }: PrivyBoundaryProps) {
  const config = readPrivyPublicConfig();

  if (!config.ok) {
    return <PrivyConfigurationError missing={config.missing} />;
  }

  return (
    <PrivyProvider
      appId={config.value.appId}
      clientId={config.value.clientId}
    >
      {children}
    </PrivyProvider>
  );
}

function PrivyConfigurationError({ missing }: { missing: string[] }) {
  return (
    <AppScreen>
      <View accessibilityRole="alert" style={styles.errorScreen}>
        <Text style={styles.title}>Authentication is not configured</Text>
        <Text style={styles.message}>
          Add the following public build values, then rebuild the app:
        </Text>
        <Text selectable style={styles.variables}>
          {missing.join('\n')}
        </Text>
      </View>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  errorScreen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
    paddingHorizontal: layout.screenPadding,
  },
  title: {
    ...typography.heading,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  message: {
    ...typography.body,
    maxWidth: 360,
    marginTop: spacing.md,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  variables: {
    ...typography.bodyCompact,
    marginTop: spacing.md,
    color: colors.accentSoft,
    textAlign: 'center',
  },
});
