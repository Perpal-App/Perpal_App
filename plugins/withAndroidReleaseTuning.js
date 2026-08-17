const fs = require('node:fs');
const path = require('node:path');
const { withDangerousMod, withGradleProperties } = require('expo/config-plugins');

/**
 * Android release build tuning.
 *
 * This lives here rather than in `android/gradle.properties` because that directory is gitignored and
 * regenerated: `expo prebuild` rewrites it from the template on every clean build and on every EAS
 * build, so anything edited there is lost. A config plugin is the only place these settings survive.
 *
 * Written by hand instead of adding `expo-build-properties`, for one reason: that package covers
 * minification, resource shrinking and packaging, but not `reactNativeArchitectures` — which is the
 * single largest lever on this app's APK. Needing a second mechanism for the biggest setting is what
 * makes the dependency not worth its weight here.
 *
 * Measured against the 198 MB release APK this replaced:
 *
 *   lib/arm64-v8a   101.0 MB   (libmopro.so alone is 78.2 MB of it)
 *   lib/x86          23.7 MB
 *   lib/x86_64       23.2 MB
 *   lib/armeabi-v7a  15.7 MB
 *   classes*.dex     41.4 MB
 *   assets            14.8 MB   (the Hermes bundle)
 *   res + arsc         4.8 MB
 */

/** Marks the appended ProGuard block so a re-run does not stack duplicates. */
const PROGUARD_MARKER = '# --- perpal release tuning ---';

const GRADLE_PROPERTIES = [
  /**
   * One ABI, and size is the smaller reason.
   *
   * `libmopro.so` — the Umbra Groth16 prover — ships for `arm64-v8a` only. The other three ABIs were
   * carrying every other native library but not the prover, so a build for them cannot generate a
   * proof at all, and the app's own rule is that a missing native prover requires a rebuilt binary
   * rather than any fallback. Those 62.6 MB were three architectures on which private funding is
   * broken by construction.
   *
   * `x86` and `x86_64` are emulator-only; no shipping Android device uses them, and an Apple Silicon
   * emulator is `arm64-v8a` anyway. `armeabi-v7a` is 32-bit ARM, which Play has not accepted as a
   * sole target since 2019. Restore `armeabi-v7a` here only if a real 32-bit device has to be
   * supported, and accept that proving will be unavailable on it.
   */
  ['reactNativeArchitectures', 'arm64-v8a'],

  /**
   * R8. Off by default in the Expo template, which is why four dex files reached 41.4 MB.
   *
   * This is the one setting here that can break a working build rather than only shrink it: R8 removes
   * classes nothing statically references, and anything resolved by name at runtime looks unreferenced.
   * The keep rules below cover the reflective surfaces this app actually has. It still needs a release
   * build exercised through login, funding and proving before it goes near production.
   */
  ['android.enableMinifyInReleaseBuilds', 'true'],

  /** Drops unreferenced resources. Requires R8, so it is meaningless without the flag above. */
  ['android.enableShrinkResourcesInReleaseBuilds', 'true'],

  /**
   * Compress native libraries in the APK.
   *
   * The template sets this false, which is correct for an app bundle — Play compresses per-device and
   * uncompressed libraries load faster from the APK. In a universal APK it means 163.6 MB of `.so`
   * stored verbatim, and `libmopro.so` is 66 MB of `.text` that compresses well.
   *
   * The trade-off is real and worth knowing: legacy packaging extracts the libraries at install time,
   * so the download shrinks while the installed footprint grows. For internal APK distribution that
   * is the right way round. Set it back to false if this project switches to shipping bundles only.
   */
  ['expo.useLegacyPackaging', 'true'],

  /**
   * Nothing in the app renders a GIF. Animated GIF support pulls in a Fresco decoder for a format
   * that never appears; market marks are SVG through `expo-image` and the one animation is Lottie.
   */
  ['expo.gif.enabled', 'false'],
];

/**
 * Keep rules for the code R8 cannot see being used.
 *
 * Every entry here is a surface resolved by name at runtime — a module registry lookup, a JNI symbol,
 * a serializer, an annotation. Deliberately scoped to those packages rather than a blanket keep, since
 * a rule broad enough to be safe everywhere would shrink nothing.
 */
const PROGUARD_RULES = `
# Stack traces stay readable, and reflection on generics and annotations keeps working.
-keepattributes *Annotation*, Signature, InnerClasses, EnclosingMethod, Exceptions, SourceFile, LineNumberTable

# Expo's module registry resolves modules and their methods by name.
-keep class expo.modules.** { *; }
-keep @expo.modules.core.interfaces.DoNotStrip class * { *; }
-keepclassmembers class * { @expo.modules.core.interfaces.DoNotStrip *; }

# React Native: JNI entry points, turbomodules, and everything the C++ side looks up.
-keep class com.facebook.jni.** { *; }
-keep class com.facebook.react.turbomodule.** { *; }
-keep class com.facebook.react.bridge.** { *; }
-keep @com.facebook.proguard.annotations.DoNotStrip class * { *; }
-keepclassmembers class * { @com.facebook.proguard.annotations.DoNotStrip *; }
-keepclassmembers class * { @com.facebook.react.uimanager.annotations.ReactProp <methods>; }

# Reanimated and Worklets call into Kotlin from the UI thread runtime.
-keep class com.swmansion.reanimated.** { *; }
-keep class com.swmansion.worklets.** { *; }

# Nitro Modules backs MMKV as a HybridObject, bound by name from C++.
-keep class com.margelo.nitro.** { *; }

# The Umbra prover: its React Native module plus the UniFFI bindings the Rust side calls back into.
-keep class com.moproffi.** { *; }
-keep class uniffi.** { *; }

# Passkeys go through Play Services FIDO, which is reached reflectively.
-keep class com.google.android.gms.fido.** { *; }

# Kotlin serialization generates serializers that are looked up, not called.
-keepclassmembers class ** { *** Companion; }
-keepclasseswithmembers class ** { kotlinx.serialization.KSerializer serializer(...); }
-keep,includedescriptorclasses class **$$serializer { *; }

# Networking libraries ship their own rules; these only silence warnings about optional APIs.
-dontwarn okhttp3.**
-dontwarn okio.**
-dontwarn kotlinx.coroutines.**
`;

function withArchitecturesAndFlags(config) {
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

function withKeepRules(config) {
  return withDangerousMod(config, ['android', (androidConfig) => {
    const file = path.join(
      androidConfig.modRequest.platformProjectRoot,
      'app',
      'proguard-rules.pro',
    );
    const current = fs.readFileSync(file, 'utf8');

    // Idempotent: prebuild may run against a directory this plugin has already written to.
    if (!current.includes(PROGUARD_MARKER)) {
      fs.writeFileSync(file, `${current.trimEnd()}\n\n${PROGUARD_MARKER}${PROGUARD_RULES}`);
    }

    return androidConfig;
  }]);
}

module.exports = function withAndroidReleaseTuning(config) {
  return withKeepRules(withArchitecturesAndFlags(config));
};
