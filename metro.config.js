// Learn more: https://docs.expo.dev/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// dotLottie (`.lottie`) files are zipped bundles; Metro does not treat them as
// assets by default, so `require('*.lottie')` would fail to bundle. Register the
// extension so lottie-react-native can load them.
config.resolver.assetExts.push('lottie');

// React Native supplies Web APIs, not Node's `crypto` module. Privy's `jose`
// dependency explicitly exports a browser/WebCrypto build, but package exports
// otherwise fall through from the native-only `react-native` condition to its
// Node `import` build. Assert `browser` for native platforms so Metro selects the
// intended WebCrypto entry instead of trying to bundle Node `crypto`/`buffer`.
for (const platform of ['ios', 'android', 'tvos', 'macos']) {
  const conditions = config.resolver.unstable_conditionsByPlatform[platform];

  if (!conditions.includes('browser')) {
    conditions.push('browser');
  }
}

module.exports = config;
