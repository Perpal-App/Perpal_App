import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import type { SocialAuthProvider } from '@/integrations/privy/usePrivyAuth';
import { colors, layout, radii, spacing, typography } from '@/theme/tokens';

type AuthProviderButtonProps = {
  provider: SocialAuthProvider;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
};

const providerCopy: Record<
  SocialAuthProvider,
  { accessibilityLabel: string; label: string }
> = {
  google: {
    accessibilityLabel: 'Continue with Google',
    label: 'Google',
  },
  twitter: {
    accessibilityLabel: 'Continue with X',
    label: 'X',
  },
};

/** Full-width Privy-style provider row with no press or entrance animation. */
export function AuthProviderButton({
  provider,
  onPress,
  disabled = false,
  loading = false,
}: AuthProviderButtonProps) {
  const copy = providerCopy[provider];

  return (
    <Pressable
      accessibilityLabel={copy.accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ busy: loading, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.button, disabled && styles.disabled]}
    >
      <View accessibilityElementsHidden style={styles.iconBox}>
        <ProviderIcon provider={provider} />
      </View>
      <Text style={styles.label}>{copy.label}</Text>
      <View accessibilityElementsHidden style={styles.trailing}>
        {loading ? <ActivityIndicator color={colors.onLight} size="small" /> : null}
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
          fill={colors.onLight}
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
    minHeight: 54,
    minWidth: layout.minTouchTarget,
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.glassEdge,
    borderRadius: radii.md,
    backgroundColor: colors.textPrimary,
    paddingHorizontal: spacing.md,
  },
  iconBox: {
    width: 28,
    alignItems: 'center',
  },
  label: {
    ...typography.label,
    flex: 1,
    color: colors.onLight,
    textAlign: 'center',
  },
  trailing: {
    width: 28,
    alignItems: 'center',
  },
  disabled: {
    opacity: 0.5,
  },
});
