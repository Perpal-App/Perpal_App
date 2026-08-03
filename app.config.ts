import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * Perpal — private, non-custodial perpetuals client.
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
const IOS_BUNDLE_IDENTIFIER = 'com.perpal.app';
const ANDROID_PACKAGE = 'com.perpal.app';
const URL_SCHEME = 'perpal';

// Surface-level brand colors only. Semantic design tokens live in the app.
const BACKGROUND = '#0B0D10';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'Perpal',
  slug: 'perpal',
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
        // Deliberately blank launch screen: flat background, no mark.
        //
        // expo-splash-screen requires an image, and Android 12+ requires a
        // splash icon drawable, so `splash-icon.png` is a fully transparent
        // 1024x1024 RGBA asset that satisfies both without rendering anything.
        // Replace that file with real art to bring a launch logo back; the
        // config does not need to change.
        image: './assets/splash-icon.png',
        imageWidth: 200,
        resizeMode: 'contain',
        backgroundColor: BACKGROUND,
      },
    ],
    [
      'expo-local-authentication',
      {
        faceIDPermission: 'Perpal uses Face ID to unlock your on-device trading key.',
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
    reactCompiler: false,
  },
});
