/**
 * Native entry point.
 *
 * Order is load-bearing: polyfills, then gesture handler, then the router.
 * Nothing that touches keys, signing or a protocol SDK may be imported above
 * the polyfill import.
 */
import './src/polyfills';
import 'react-native-gesture-handler';
import './src/integrations/observability/installRedactedErrorHandler';
import 'expo-router/entry';
