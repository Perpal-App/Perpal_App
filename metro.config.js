// Learn more: https://docs.expo.dev/guides/customizing-metro
const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
const nativePlatforms = ['ios', 'android', 'tvos', 'macos'];

// dotLottie (`.lottie`) files are zipped bundles; Metro does not treat them as
// assets by default, so `require('*.lottie')` would fail to bundle. Register the
// extension so lottie-react-native can load them.
config.resolver.assetExts.push('lottie');

// React Native supplies Web APIs, not Node's `crypto` module. Privy's `jose`
// dependency explicitly exports a browser/WebCrypto build, but package exports
// otherwise fall through from the native-only `react-native` condition to its
// Node `import` build. Assert `browser` for native platforms so Metro selects the
// intended WebCrypto entry instead of trying to bundle Node `crypto`/`buffer`.
for (const platform of nativePlatforms) {
  const conditions = config.resolver.unstable_conditionsByPlatform[platform];

  if (!conditions.includes('browser')) {
    conditions.push('browser');
  }
}

// @noble/hashes 1.8 maps its valid `./crypto` export to `./crypto.js` in
// browsers, but does not export that redirected subpath. Metro warns before
// falling back to this same file. Resolve only Noble's internal request to the
// intended browser implementation, preserving package exports everywhere else.
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (
    nativePlatforms.includes(platform) &&
    moduleName === '@drift-labs/sdk'
  ) {
    const packageRoot = path.dirname(require.resolve('@drift-labs/sdk/package.json'));

    return {
      filePath: path.join(packageRoot, 'lib', 'browser', 'index.js'),
      type: 'sourceFile',
    };
  }

  const isNobleCryptoRequest =
    moduleName === '@noble/hashes/crypto' ||
    moduleName === '@noble/hashes/crypto.js';
  const noblePackageSegment = [
    path.sep,
    'node_modules',
    path.sep,
    '@noble',
    path.sep,
    'hashes',
    path.sep,
  ].join('');

  if (
    nativePlatforms.includes(platform) &&
    isNobleCryptoRequest &&
    context.originModulePath.includes(noblePackageSegment)
  ) {
    const packageEntry = require.resolve('@noble/hashes', {
      paths: [path.dirname(context.originModulePath)],
    });

    return {
      filePath: path.join(path.dirname(packageEntry), 'crypto.js'),
      type: 'sourceFile',
    };
  }

  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
