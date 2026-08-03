import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * Pivote — private, non-custodial perpetuals client.
 *
 * This app is a custom native build only. It is not supported under Expo Go:
 * Privy, secure storage, biometrics and (later) native proving all require a
 * custom development build or a release-like build.
 *
 * Identity values (name, slug, bundle identifiers, scheme) live here because
 * they are app identity, not configuration. Every service origin, RPC endpoint,
 * relayer endpoint and provider key must come from environment configuration
 * instead — see `.env.example`.
 */
const IOS_BUNDLE_IDENTIFIER = 'com.pivote.app';
const ANDROID_PACKAGE = 'com.pivote.app';
const URL_SCHEME = 'pivote';

// Surface-level brand colors only. Semantic design tokens live in the app.
const BACKGROUND = '#0B0D10';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'Pivote',
  slug: 'pivote',
  version: '0.1.0',
  scheme: URL_SCHEME,
  orientation: 'portrait',
  userInterfaceStyle: 'dark',
  // New architecture is always enabled on SDK 57; the config key no longer exists.
  icon: './assets/icon.png',
  assetBundlePatterns: ['**/*'],
  ios: {
    bundleIdentifier: IOS_BUNDLE_IDENTIFIER,
    supportsTablet: false,
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    package: ANDROID_PACKAGE,
    predictiveBackGestureEnabled: false,
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon-foreground.png',
      backgroundColor: BACKGROUND,
    },
  },
  plugins: [
    'expo-router',
    'expo-secure-store',
    'expo-status-bar',
    [
      'expo-splash-screen',
      {
        image: './assets/splash-icon.png',
        imageWidth: 160,
        resizeMode: 'contain',
        backgroundColor: BACKGROUND,
      },
    ],
    [
      'expo-local-authentication',
      {
        faceIDPermission: 'Pivote uses Face ID to unlock your on-device trading key.',
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
    reactCompiler: false,
  },
});
