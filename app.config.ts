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
/**
 * Launch screen fill. Kept identical to `colors.background` in `src/theme/tokens.ts`
 * rather than sharing `BACKGROUND` with the adaptive icon: the app draws nothing but
 * this colour while the saved session is being restored, so the two surfaces have to
 * match exactly or the handoff from launch screen to first frame reads as a flicker.
 * Duplicated because this file is evaluated by the Expo CLI, outside the app's module
 * graph and path aliases.
 */
const LAUNCH_BACKGROUND = '#07060B';

/**
 * Every font the app is allowed to render, embedded natively at build time so
 * the faces are available synchronously on the first frame with no runtime
 * loading. Only these files ship; the rest of `assets/fonts` is unused.
 *
 * Each face is registered under its own PostScript name rather than as weights
 * of a single "Poppins" family. That is what makes `fontFamily: 'Poppins-SemiBold'`
 * resolve the real SemiBold file on both platforms — iOS matches the PostScript
 * name, Android matches the family name declared below — instead of letting
 * Android synthesise a bold from Regular. Each face is declared at weight 400
 * for the same reason: styles pick a face by name and never set `fontWeight`.
 * The app-side counterpart of this list is `src/theme/fonts.ts`.
 */
const APP_FONTS = [
  { family: 'Poppins-Regular', path: './assets/fonts/poppins/Poppins-Regular.ttf' },
  { family: 'Poppins-Medium', path: './assets/fonts/poppins/Poppins-Medium.ttf' },
  { family: 'Poppins-SemiBold', path: './assets/fonts/poppins/Poppins-SemiBold.ttf' },
  { family: 'Poppins-Bold', path: './assets/fonts/poppins/Poppins-Bold.ttf' },
  {
    family: 'PatrickHand-Regular',
    path: './assets/fonts/Patrick_Hand/PatrickHand-Regular.ttf',
  },
] as const;

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'Perpal',
  slug: 'perpal',
  owner: 'perpal',
  version: '0.1.0',
  scheme: URL_SCHEME,
  orientation: 'default',
  userInterfaceStyle: 'dark',
  // New architecture is always enabled on SDK 57; the config key no longer exists.
  icon: './assets/icon.png',
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
  updates: {
    url: 'https://u.expo.dev/0eadd12d-2151-4907-931e-774656309e72',
  },
  runtimeVersion: {
    policy: 'fingerprint',
  },
  plugins: [
    'expo-router',
    'expo-asset',
    'expo-image',
    'expo-secure-store',
    'expo-status-bar',
    [
      'expo-font',
      {
        ios: { fonts: APP_FONTS.map((font) => font.path) },
        android: {
          fonts: APP_FONTS.map((font) => ({
            fontFamily: font.family,
            fontDefinitions: [{ path: font.path, weight: 400 }],
          })),
        },
      },
    ],
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
        backgroundColor: LAUNCH_BACKGROUND,
      },
    ],
    [
      'expo-local-authentication',
      {
        faceIDPermission: 'Perpal uses device authentication to protect private trading actions.',
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
    reactCompiler: false,
  },
  extra: {
    eas: {
      projectId: '0eadd12d-2151-4907-931e-774656309e72',
    },
  },
});
