import { StyleSheet, Text, View } from 'react-native';

import { readAppConfig } from '@/config/appConfig';
import { colors, radii, spacing, typography } from '@/theme/tokens';

/**
 * Shows which venue and cluster this binary was built against.
 *
 * Deliberately hidden on mainnet builds: it exists so nobody ever has to guess
 * whether a running app is pointed at devnet, and a badge on a production build
 * would be noise. If config is invalid the app never gets this far, so an
 * unreadable config renders nothing rather than a misleading label.
 */
export function BuildTargetBadge() {
  const config = readAppConfig();

  if (!config.ok || config.value.cluster === 'mainnet') {
    return null;
  }

  return (
    <View style={styles.badge}>
      <Text style={styles.label}>
        {config.value.cluster} · {config.value.venue}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radii.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  label: {
    ...typography.label,
    color: colors.textMuted,
  },
});
