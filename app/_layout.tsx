import { StatusBar } from 'expo-status-bar';
import { StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import {
  SafeAreaProvider,
  initialWindowMetrics,
} from 'react-native-safe-area-context';

import { PrivyBoundary } from '@/integrations/privy/PrivyBoundary';
import { AuthNavigationGate } from '@/navigation/AuthNavigationGate';

/**
 * Root shell. The safe-area provider owns device metrics, and Privy is mounted
 * once here so every route shares the same persisted authentication session.
 * AuthNavigationGate waits for restoration and owns all route authorization.
 */
export default function RootLayout() {
  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        <PrivyBoundary>
          <StatusBar style="light" />
          <AuthNavigationGate />
        </PrivyBoundary>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
