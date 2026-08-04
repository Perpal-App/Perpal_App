import { StatusBar } from 'expo-status-bar';
import { StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import {
  SafeAreaProvider,
  initialWindowMetrics,
} from 'react-native-safe-area-context';

import { PrivyBoundary } from '@/integrations/privy/PrivyBoundary';
import { AuthNavigationGate } from '@/navigation/AuthNavigationGate';
import { AppPreferencesProvider } from '@/storage/AppPreferencesProvider';

/**
 * Root shell. The safe-area provider owns device metrics, Privy owns encrypted
 * session persistence, and AppPreferencesProvider owns bounded non-secret MMKV
 * state. AuthNavigationGate waits for restoration and authorizes every route.
 */
export default function RootLayout() {
  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        <PrivyBoundary>
          <AppPreferencesProvider>
            <StatusBar style="light" />
            <AuthNavigationGate />
          </AppPreferencesProvider>
        </PrivyBoundary>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
