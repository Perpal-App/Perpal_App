import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import {
  SafeAreaProvider,
  initialWindowMetrics,
} from 'react-native-safe-area-context';

import { PrivyBoundary } from '@/integrations/privy/PrivyBoundary';
import { globalScreenOptions } from '@/navigation/screenOptions';

/**
 * Root shell. The safe-area provider owns device metrics, and Privy is mounted
 * once here so every route shares the same persisted authentication session.
 * Screen transitions come from the shared `globalScreenOptions` so every route
 * in the app animates identically.
 */
export default function RootLayout() {
  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        <PrivyBoundary>
          <StatusBar style="light" />
          <Stack screenOptions={globalScreenOptions} />
        </PrivyBoundary>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
