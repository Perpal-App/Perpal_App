const { withGradleProperties } = require('expo/config-plugins');

/**
 * Android properties not supported by expo-build-properties.
 *
 * Prebuild regenerates `android/gradle.properties`, so source-owned values must
 * be applied through config plugins. Architecture, shrinking, ProGuard and
 * packaging are configured by the official plugin in `app.config.ts`.
 */
const GRADLE_PROPERTIES = [
  ['org.gradle.jvmargs', '-Xmx6144m -XX:MaxMetaspaceSize=1024m'],
  ['expo.gif.enabled', 'false'],
];
function withRemainingAndroidProperties(config) {
  return withGradleProperties(config, (gradleConfig) => {
    for (const [key, value] of GRADLE_PROPERTIES) {
      const existing = gradleConfig.modResults.find(
        (item) => item.type === 'property' && item.key === key,
      );

      if (existing === undefined) {
        gradleConfig.modResults.push({ type: 'property', key, value });
      } else {
        existing.value = value;
      }
    }

    return gradleConfig;
  });
}

module.exports = function withAndroidReleaseTuning(config) {
  return withRemainingAndroidProperties(config);
};
