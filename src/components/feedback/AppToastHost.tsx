import { useEffect, useSyncExternalStore } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PresenceView } from '@/components/motion/PresenceView';
import {
  dismissAppToast,
  readAppToast,
  subscribeAppToast,
} from '@/storage/appToast';
import { colors, radii, spacing, typography } from '@/theme/tokens';

const DISMISS_AFTER_MS = 3_500;

export function AppToastHost() {
  const toast = useSyncExternalStore(subscribeAppToast, readAppToast, readAppToast);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (toast === null || toast.outcome === 'error') return;
    const timer = setTimeout(() => dismissAppToast(toast.id), DISMISS_AFTER_MS);
    return () => clearTimeout(timer);
  }, [toast]);

  return (
    <View
      pointerEvents="box-none"
      style={[styles.host, { paddingTop: insets.top + spacing.xs }]}
    >
      <PresenceView offsetY={-12} style={styles.presence} visible={toast !== null}>
        {toast === null ? null : (
          <View
            accessibilityLiveRegion={toast.outcome === 'error' ? 'assertive' : 'polite'}
            {...(toast.outcome === 'error' ? { accessibilityRole: 'alert' as const } : {})}
            style={[styles.toast, styles[toast.outcome]]}
          >
            <View style={styles.copy}>
              <Text numberOfLines={1} style={styles.title}>{toast.title}</Text>
              <Text numberOfLines={2} style={styles.message}>{toast.message}</Text>
            </View>
            <Pressable
              accessibilityLabel="Dismiss message"
              accessibilityRole="button"
              hitSlop={10}
              onPress={() => dismissAppToast(toast.id)}
              style={({ pressed }) => [styles.close, pressed && styles.pressed]}
            >
              <Text style={styles.closeLabel}>×</Text>
            </Pressable>
          </View>
        )}
      </PresenceView>
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 100,
    alignItems: 'center',
    paddingHorizontal: spacing.md,
  },
  presence: { width: '100%', maxWidth: 520 },
  toast: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.sm,
    borderWidth: 1,
    borderRadius: radii.sm,
    borderCurve: 'continuous',
    backgroundColor: colors.surfaceElevated,
  },
  success: { borderColor: colors.positive },
  error: { borderColor: colors.negative },
  info: { borderColor: colors.accentSoft },
  copy: { flex: 1, minWidth: 0, gap: 2 },
  title: { ...typography.label, color: colors.textPrimary },
  message: { ...typography.bodyCompact, color: colors.textSecondary },
  close: {
    width: 40,
    height: 40,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeLabel: { ...typography.heading, color: colors.textSecondary },
  pressed: { opacity: 0.65 },
});
