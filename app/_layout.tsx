import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import {
  SafeAreaProvider,
  initialWindowMetrics,
} from 'react-native-safe-area-context';

import { PrivyBoundary } from '@/integrations/privy/PrivyBoundary';
import { colors } from '@/theme/tokens';

/**
 * Root shell. The safe-area provider owns device metrics, and Privy is mounted
 * once here so every route shares the same persisted authentication session.
 */
export default function RootLayout() {
  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        <PrivyBoundary>
          <StatusBar style="light" />
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: styles.content,
            }}
          />
        </PrivyBoundary>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { backgroundColor: colors.background },
});
