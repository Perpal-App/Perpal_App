import { StatusBar } from 'expo-status-bar';
import { StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import {
  SafeAreaProvider,
  initialWindowMetrics,
} from 'react-native-safe-area-context';

import { readAppConfig } from '@/config/appConfig';
import { ConfigErrorScreen } from '@/features/diagnostics/screens/ConfigErrorScreen';
import { PrivyBoundary } from '@/integrations/privy/PrivyBoundary';
import { WalletProvisioningProvider } from '@/integrations/privy/useWalletProvisioning';
import { AuthNavigationGate } from '@/navigation/AuthNavigationGate';
import { AppPreferencesProvider } from '@/storage/AppPreferencesProvider';

/**
 * Root shell. The safe-area provider owns device metrics, Privy owns encrypted
 * session persistence, and AppPreferencesProvider owns bounded non-secret MMKV
 * state. AuthNavigationGate waits for restoration and authorizes every route.
 *
 * Config is checked before anything else mounts. A build missing its cluster,
 * venue, or gateway must not reach auth, because a partially configured app could
 * otherwise dial the wrong network.
 */
export default function RootLayout() {
  const config = readAppConfig();

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        <StatusBar style="light" />
        {config.ok ? (
          <PrivyBoundary>
            <WalletProvisioningProvider>
              <AppPreferencesProvider>
                <AuthNavigationGate />
              </AppPreferencesProvider>
            </WalletProvisioningProvider>
          </PrivyBoundary>
        ) : (
          <ConfigErrorScreen issues={config.issues} />
        )}
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
