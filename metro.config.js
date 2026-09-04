// Learn more: https://docs.expo.dev/guides/customizing-metro
const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
const nativePlatforms = ['ios', 'android', 'tvos', 'macos'];

// dotLottie (`.lottie`) files are zipped bundles; Metro does not treat them as
// assets by default, so `require('*.lottie')` would fail to bundle. Register the
// extension so lottie-react-native can load them.
config.resolver.assetExts.push('lottie');

// Privy's `jose` needs its WebCrypto build, but enabling the `browser` condition
// globally makes Solana Kit bypass its React Native assertions. Keep both
// resolver workarounds package-scoped so native exports remain authoritative.
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (nativePlatforms.includes(platform) && moduleName === 'rpc-websockets') {
    const packageEntry = require.resolve('rpc-websockets', {
      paths: [path.dirname(context.originModulePath)],
    });

    return {
      // rpc-websockets 9.x has browser/node export conditions but no
      // react-native/default condition, so Metro otherwise warns and falls
      // back to its Node entry. React Native supplies the WebSocket global
      // expected by this browser build.
      filePath: path.join(path.dirname(packageEntry), 'index.browser.cjs'),
      type: 'sourceFile',
    };
  }

  if (nativePlatforms.includes(platform) && moduleName === 'jose') {
    const packageRoot = path.dirname(
      require.resolve('jose/package.json', {
        paths: [path.dirname(context.originModulePath)],
      }),
    );

    return {
      filePath: path.join(packageRoot, 'dist', 'browser', 'index.js'),
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
