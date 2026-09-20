import { useEffect, useSyncExternalStore } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PresenceView } from '@/components/motion/PresenceView';
import {
  dismissAppToast,
  readAppToast,
  subscribeAppToast,
  type AppToast,
} from '@/storage/appToast';
import { colors, radii, spacing, typography } from '@/theme/tokens';

const DISMISS_AFTER_MS = 3_500;

/** Bar height. One line of `bodyCompact` plus symmetric padding, and enough to seat a 20pt mark. */
const BAR_HEIGHT = 52;
const MARK = 20;

type Outcome = AppToast['outcome'];

const TINTS: Readonly<Record<Outcome, string>> = {
  error: colors.negative,
  info: colors.accentSoft,
  success: colors.positive,
};

/**
 * A single-line status bar, built to the snackbar pattern.
 *
 * Flat fill and no outline. It used to carry a full-point border in the outcome's colour around the
 * whole bar, which is what made it read as a framed card rather than as a passing message — and with
 * two lines of text inside, a 64pt one. A snackbar is a bar: one surface, one line, one action.
 *
 * The outcome moved from that border onto a filled mark at the leading edge, which is both the pattern
 * Material uses and the only version that survives the app's own rule against stating a state in
 * colour alone — a tick, an alert and an info mark are three different shapes before they are three
 * different hues.
 *
 * Elevated rather than rimmed, on the same shadow the raised chips use. That is what separates it from
 * whatever it is floating over, and it is the signal a border was being asked to carry.
 */
export function AppToastHost() {
  const toast = useSyncExternalStore(subscribeAppToast, readAppToast, readAppToast);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (toast === null || toast.outcome === 'error') return;
    const timer = setTimeout(() => dismissAppToast(toast.id), DISMISS_AFTER_MS);
    return () => clearTimeout(timer);
  }, [toast]);

  return (
    <View
      pointerEvents="box-none"
      style={[styles.host, { paddingTop: insets.top + spacing.xs }]}
    >
      <PresenceView offsetY={-12} style={styles.presence} visible={toast !== null}>
        {toast === null ? null : (
          <View
            accessibilityLiveRegion={toast.outcome === 'error' ? 'assertive' : 'polite'}
            {...(toast.outcome === 'error' ? { accessibilityRole: 'alert' as const } : {})}
          >
            {/* The whole bar dismisses, which is what let the close button go. At 36pt plus its gap
                that button was taking 48 of the 264pt a 360pt screen has for this line — a fifth of
                the message, spent on a target the entire bar can be. Errors are the case that needs
                it, since they never time out, and they get the largest possible target instead of the
                smallest. */}
            <Pressable
              accessibilityHint="Dismisses this message"
              accessibilityLabel={toast.message}
              accessibilityRole="button"
              onPress={() => dismissAppToast(toast.id)}
              style={({ pressed }) => [styles.bar, pressed && styles.pressed]}
            >
              <View
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                pointerEvents="none"
                style={styles.mark}
              >
                <ToastMark outcome={toast.outcome} />
              </View>

              {/* One line, and it truncates rather than wrapping. A bar that grows to two lines stops
                  being a bar, which is how the old one reached 64pt. Anything too long to fit here is
                  too long for a transient message and belongs in the panel that raised it. */}
              <Text maxFontSizeMultiplier={1.3} numberOfLines={1} style={styles.message}>
                {toast.message}
              </Text>
            </Pressable>
          </View>
        )}
      </PresenceView>
    </View>
  );
}

/**
 * The outcome, as a filled mark on the 3–21 ink grid the rest of the app's glyphs use.
 *
 * Alert and info are the same disc with different contents punched out under `evenodd`, so a failure
 * and a notice are the same weight in the corner of the eye and differ by shape. The tick is open,
 * because a success does not need the mass of a filled disc to be read.
 */
function ToastMark({ outcome }: { readonly outcome: Outcome }) {
  const tint = TINTS[outcome];

  if (outcome === 'success') {
    return (
      <Svg height={MARK} viewBox="0 0 24 24" width={MARK}>
        <Path
          d="M4 12.25 9.5 17.5 20 6.5"
          fill="none"
          stroke={tint}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2.6}
        />
      </Svg>
    );
  }

  return (
    <Svg height={MARK} viewBox="0 0 24 24" width={MARK}>
      <Path
        d={
          'M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 1 0 0-17Z' +
          (outcome === 'error'
            ? 'M12 7.9a1.05 1.05 0 0 1 1.05 1.05v3.5a1.05 1.05 0 0 1-2.1 0V8.95A1.05 1.05 0 0 1 12 7.9Z' +
              'M10.85 16.15a1.15 1.15 0 1 0 2.3 0 1.15 1.15 0 1 0-2.3 0Z'
            : 'M12 16.1a1.05 1.05 0 0 1-1.05-1.05v-3.5a1.05 1.05 0 0 1 2.1 0v3.5A1.05 1.05 0 0 1 12 16.1Z' +
              'M10.85 7.85a1.15 1.15 0 1 0 2.3 0 1.15 1.15 0 1 0-2.3 0Z')
        }
        fill={tint}
        fillRule="evenodd"
      />
    </Svg>
  );
}

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 100,
    alignItems: 'center',
    paddingHorizontal: spacing.md,
  },
  presence: { width: '100%', maxWidth: 520 },
  bar: {
    minHeight: BAR_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    borderCurve: 'continuous',
    backgroundColor: colors.surfaceElevated,
    // The app's raised-material shadow. Legacy `shadow*` plus `elevation` rather than `boxShadow`,
    // which needs the New Architecture and fails silently without it.
    shadowColor: colors.raisedHalo,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 1,
    shadowRadius: 4,
    elevation: 3,
  },
  mark: { width: MARK, height: MARK, flexShrink: 0 },
  // `textPrimary`, not the `textSecondary` the second line used to carry. It is the only line now, so
  // it is the message rather than a footnote under one.
  message: { ...typography.bodyCompact, flex: 1, minWidth: 0, color: colors.textPrimary },
  pressed: { opacity: 0.65 },
});
