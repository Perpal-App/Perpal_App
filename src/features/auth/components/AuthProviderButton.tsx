import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import type { SocialAuthProvider } from '@/integrations/privy/usePrivyAuth';
import { colors, layout } from '@/theme/tokens';

// Neutral slate chip (deliberately not violet) that reads clearly as a raised
// circle against the near-white card instead of blending into it.
const PRIVY_BORDER = '#D3D7E0';
const PRIVY_SURFACE = '#EEF0F5';
const PRIVY_PRESSED = '#E1E4EC';
// Solid darker lip along the bottom edge. This is a real border, not a blurred
// drop shadow, so the button reads as raised/bulging without floating.
const PRIVY_EDGE = '#BFC4D1';
const PRIVY_TEXT = '#040217';

const BUTTON_SIZE = 60;
const RAISED_LIP = 4;
const PRESSED_LIP = 1;

const providerAccessibilityLabels: Record<SocialAuthProvider, string> = {
  google: 'Continue with Google',
  twitter: 'Continue with X',
};

type AuthProviderButtonProps = {
  provider: SocialAuthProvider;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
};

/** Compact icon-only OAuth action for the horizontal provider row. */
export function AuthProviderButton({
  provider,
  onPress,
  disabled = false,
  loading = false,
}: AuthProviderButtonProps) {
  return (
    <Pressable
      accessibilityLabel={providerAccessibilityLabels[provider]}
      accessibilityRole="button"
      accessibilityState={{ busy: loading, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        pressed && !disabled && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      <View accessibilityElementsHidden style={styles.iconBox}>
        {loading ? (
          <ActivityIndicator color={colors.onLight} size="small" />
        ) : (
          <ProviderIcon provider={provider} />
        )}
      </View>
    </Pressable>
  );
}

function ProviderIcon({ provider }: { provider: SocialAuthProvider }) {
  if (provider === 'twitter') {
    return (
      <Svg height={24} viewBox="0 0 24 24" width={24}>
        <Path
          d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z"
          fill={PRIVY_TEXT}
        />
      </Svg>
    );
  }

  return (
    <Svg height={24} viewBox="0 0 24 24" width={24}>
      <Path
        d="M17.382 13.486h-4.818v-2.74h8.372q.1.717.1 1.481c0 2.82-.977 5.168-2.642 6.786H15.95v-1.654a5.15 5.15 0 0 0 1.986-3.206l.123-.667z"
        fill="#4285F4"
      />
      <Path
        d="M12 22c2.7 0 4.964-.896 6.618-2.423l-3.232-2.509c-.895.6-2.04.955-3.386.955-2.604 0-4.809-1.76-5.595-4.123H3.064v2.59A10 10 0 0 0 12 22"
        fill="#34A853"
      />
      <Path
        d="M6.405 13.9c-.2-.6-.314-1.24-.314-1.9s.114-1.3.314-1.9V7.51H3.064A10 10 0 0 0 2 12c0 1.614.386 3.141 1.064 4.491z"
        fill="#FBBC05"
      />
      <Path
        d="M12 5.977c1.468 0 2.786.505 3.823 1.496l2.868-2.868C16.959 2.99 14.696 2 12.001 2 8.09 2 4.708 4.24 3.063 7.51l3.34 2.59C7.192 7.736 9.397 5.977 12 5.977"
        fill="#EA4335"
      />
    </Svg>
  );
}

const styles = StyleSheet.create({
  button: {
    width: BUTTON_SIZE,
    height: BUTTON_SIZE,
    minHeight: layout.minTouchTarget,
    minWidth: layout.minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: PRIVY_BORDER,
    // Thicker bottom border forms the raised lip; the sides/top stay hairline.
    borderBottomWidth: RAISED_LIP,
    borderBottomColor: PRIVY_EDGE,
    // Full radius makes the chip a circle while the lip keeps it raised.
    borderRadius: BUTTON_SIZE / 2,
    backgroundColor: PRIVY_SURFACE,
  },
  iconBox: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    backgroundColor: PRIVY_PRESSED,
    // Collapse the lip and drop the face down so the button presses inward.
    // The extra top margin offsets the shorter bottom border, keeping height
    // constant and the row aligned.
    borderBottomWidth: PRESSED_LIP,
    marginTop: RAISED_LIP - PRESSED_LIP,
  },
  disabled: {
    opacity: 0.5,
  },
});
