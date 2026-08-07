import type { ReactNode } from 'react';
import {
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { IOSLoader } from '@/components/feedback/IOSLoader';
import { PressableScale } from '@/components/ui/PressableScale';
import { colors, fonts, spacing, typography } from '@/theme/tokens';

// Transform-only press feedback keeps text actions from reflowing their row.
const TEXT_ACTION_PRESSED_SCALE = 0.92;

const PRIVY_BRAND_URL =
  'https://privy.io/?utm_source=module&utm_medium=module&utm_campaign=registration_module';
const PRIVY_MUTED = '#9498B8';
const PRIVY_ERROR = '#B42318';
const PRIVY_ERROR_SURFACE = '#FEF3F2';
const PRIVY_ERROR_BORDER = '#FADAD6';

type AuthFormScrollProps = {
  children: ReactNode;
};

/** Scroll fallback for the fixed-height auth card and accessibility text. */
export function AuthFormScroll({ children }: AuthFormScrollProps) {
  return (
    <ScrollView
      bounces={false}
      contentContainerStyle={styles.formScroll}
      keyboardShouldPersistTaps="handled"
      nestedScrollEnabled
      showsVerticalScrollIndicator={false}
      style={styles.scroll}
    >
      {children}
    </ScrollView>
  );
}

type AuthTextActionProps = {
  disabled: boolean;
  label: string;
  loading?: boolean;
  onPress: () => void;
};

/** Static text action; intentionally has no press or entrance animation. */
export function AuthTextAction({
  disabled,
  label,
  loading = false,
  onPress,
}: AuthTextActionProps) {
  const unavailable = disabled || loading;

  return (
    <PressableScale
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ busy: loading, disabled: unavailable }}
      disabled={unavailable}
      onPress={onPress}
      pressedScale={TEXT_ACTION_PRESSED_SCALE}
      style={styles.textAction}
    >
      {loading ? (
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <IOSLoader color={colors.accent} />
        </View>
      ) : (
        <Text
          style={[
            styles.textActionLabel,
            unavailable && styles.disabledText,
          ]}
        >
          {label}
        </Text>
      )}
    </PressableScale>
  );
}

/** Privy's compact attribution footer, retained in every inline auth state. */
export function PrivyFooter() {
  return (
    <Pressable
      accessibilityLabel="Protected by Privy"
      accessibilityRole="link"
      onPress={() => void Linking.openURL(PRIVY_BRAND_URL)}
      style={styles.footer}
    >
      <Text style={styles.footerText}>Protected by</Text>
      <View style={styles.privyMark}>
        <View style={styles.privyDot} />
        <View style={styles.privyBase} />
      </View>
      <Text style={styles.privyText}>privy</Text>
    </Pressable>
  );
}

/**
 * Safe, user-facing auth alert. Presented as a soft inline banner with an alert
 * glyph rather than raw red text, so failures read as guidance, not a crash.
 * Raw SDK errors are never surfaced.
 */
export function AuthErrorMessage({ message }: { message: string }) {
  return (
    <View
      accessibilityLiveRegion="polite"
      accessibilityRole="alert"
      style={styles.errorBanner}
    >
      <AlertIcon />
      <Text style={styles.errorText}>{message}</Text>
    </View>
  );
}

function AlertIcon() {
  return (
    <Svg height={18} viewBox="0 0 24 24" width={18}>
      <Path
        d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 5.25a1 1 0 0 1 1 1v4.5a1 1 0 1 1-2 0v-4.5a1 1 0 0 1 1-1Zm0 8a1.15 1.15 0 1 1 0 2.3 1.15 1.15 0 0 1 0-2.3Z"
        fill={PRIVY_ERROR}
      />
    </Svg>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
  },
  formScroll: {
    flexGrow: 1,
  },
  textAction: {
    minHeight: 34,
    // Reserve width so swapping the label for the spinner never resizes the
    // action or shifts the row it sits in.
    minWidth: 64,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
  },
  textActionLabel: {
    ...typography.bodyCompact,
    fontFamily: fonts.semiBold,
    color: colors.accent,
  },
  disabledText: {
    color: PRIVY_MUTED,
  },
  footer: {
    minHeight: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xxs,
  },
  footerText: {
    fontFamily: fonts.regular,
    fontSize: 13,
    lineHeight: 20,
    color: PRIVY_MUTED,
  },
  privyMark: {
    width: 14,
    height: 16,
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  privyDot: {
    position: 'absolute',
    top: 0,
    width: 11,
    height: 11,
    borderRadius: 6,
    backgroundColor: PRIVY_MUTED,
  },
  privyBase: {
    width: 14,
    height: 3,
    borderRadius: 2,
    backgroundColor: PRIVY_MUTED,
  },
  privyText: {
    fontFamily: fonts.bold,
    fontSize: 16,
    lineHeight: 24,
    color: PRIVY_MUTED,
  },
  errorBanner: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: PRIVY_ERROR_BORDER,
    backgroundColor: PRIVY_ERROR_SURFACE,
  },
  errorText: {
    ...typography.bodyCompact,
    fontFamily: fonts.medium,
    flex: 1,
    color: PRIVY_ERROR,
  },
});
