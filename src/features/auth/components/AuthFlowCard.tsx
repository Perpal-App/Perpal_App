import { useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { Button } from '@/components/ui/Button';
import {
  AuthErrorMessage,
  AuthFormScroll,
  AuthTextAction,
} from '@/features/auth/components/AuthFormPrimitives';
import { AuthProviderButton } from '@/features/auth/components/AuthProviderButton';
import {
  usePrivyAuth,
  type SocialAuthProvider,
} from '@/integrations/privy/usePrivyAuth';
import { colors, radii, spacing, typography } from '@/theme/tokens';

type AuthFlowCardProps = {
  onAuthenticated: () => void;
};

type AuthStep = 'methods' | 'email' | 'otp';
type PendingAction = 'send-email' | 'verify-email' | SocialAuthProvider | 'logout';

const NO_PRESS_SCALE = 1;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const OTP_LENGTH = 6;

/**
 * Inline Privy-style login and signup flow rendered in the existing 40% sheet.
 * The SDK's managed UI is modal-only, so this keeps Privy's method order and
 * labels while preserving the app's single surface and safe-area contract.
 */
export function AuthFlowCard({ onAuthenticated }: AuthFlowCardProps) {
  const auth = usePrivyAuth();
  const [step, setStep] = useState<AuthStep>('methods');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const isBusy =
    pending !== null ||
    auth.emailState.status === 'sending-code' ||
    auth.emailState.status === 'submitting-code' ||
    auth.oauthState.status === 'loading';

  if (auth.initializationError) {
    return (
      <View accessibilityRole="alert" style={styles.centeredState}>
        <Text style={styles.title}>Sign in is unavailable</Text>
        <Text style={styles.body}>
          Authentication could not start on this device. Reopen the app and try
          again.
        </Text>
      </View>
    );
  }

  if (!auth.isReady) {
    return (
      <View accessibilityLiveRegion="polite" style={styles.centeredState}>
        <ActivityIndicator color={colors.accent} />
        <Text style={styles.stateText}>Preparing secure sign in…</Text>
      </View>
    );
  }

  if (auth.isAuthenticated) {
    const handleLogout = async () => {
      setPending('logout');
      setMessage(null);

      try {
        await auth.logout();
      } catch {
        setMessage('Sign out could not be completed. Please try again.');
      } finally {
        setPending(null);
      }
    };

    return (
      <View style={styles.centeredState}>
        <Text style={styles.title}>You’re signed in</Text>
        <Text style={styles.body}>Your secure Privy session is active.</Text>
        <View style={styles.fullWidthAction}>
          <Button
            disabled={isBusy}
            label={pending === 'logout' ? 'Signing out…' : 'Sign out'}
            onPress={() => void handleLogout()}
            pressedScale={NO_PRESS_SCALE}
            variant="secondary"
          />
        </View>
        {message ? <AuthErrorMessage message={message} /> : null}
      </View>
    );
  }

  const handleSendCode = async () => {
    const normalizedEmail = email.trim();

    if (!EMAIL_PATTERN.test(normalizedEmail)) {
      setMessage('Enter a valid email address.');
      return;
    }

    setPending('send-email');
    setMessage(null);

    try {
      await auth.sendEmailCode(normalizedEmail);
      setEmail(normalizedEmail);
      setCode('');
      setStep('otp');
    } catch {
      setMessage('We could not send a code. Check the email and try again.');
    } finally {
      setPending(null);
    }
  };

  const handleVerifyCode = async () => {
    if (code.length !== OTP_LENGTH) {
      setMessage('Enter the 6-digit code from your email.');
      return;
    }

    setPending('verify-email');
    setMessage(null);

    try {
      const authenticated = await auth.verifyEmailCode({ email, code });

      if (authenticated) {
        onAuthenticated();
      } else {
        setMessage('The code was not accepted. Request a new code and try again.');
      }
    } catch {
      setMessage('The code could not be verified. Check it and try again.');
    } finally {
      setPending(null);
    }
  };

  const handleSocialLogin = async (provider: SocialAuthProvider) => {
    setPending(provider);
    setMessage(null);

    try {
      const authenticated = await auth.loginWithSocial({ provider });

      if (authenticated) {
        onAuthenticated();
      }
      // An undefined user means the browser flow was cancelled. Cancellation is
      // not an error and leaves the unified method list in place.
    } catch {
      const providerName = provider === 'twitter' ? 'X' : 'Google';
      setMessage(
        `${providerName} authentication could not be completed. Please try again.`,
      );
    } finally {
      setPending(null);
    }
  };

  if (step === 'otp') {
    return (
      <AuthFormScroll>
        <View style={styles.form}>
          <View style={styles.formHeading}>
            <Text style={styles.title}>Enter confirmation code</Text>
            <Text style={styles.body}>
              Please check {email} for your login code.
            </Text>
          </View>
          <TextInput
            accessibilityLabel="Email verification code"
            autoComplete="one-time-code"
            editable={!isBusy}
            keyboardType="number-pad"
            maxLength={OTP_LENGTH}
            onChangeText={(value) => {
              setCode(value.replace(/\D/g, '').slice(0, OTP_LENGTH));
              setMessage(null);
            }}
            onSubmitEditing={() => void handleVerifyCode()}
            placeholder="000000"
            placeholderTextColor={colors.textMuted}
            returnKeyType="done"
            style={[styles.input, styles.codeInput]}
            textContentType="oneTimeCode"
            value={code}
          />
          <Button
            disabled={isBusy || code.length !== OTP_LENGTH}
            label={pending === 'verify-email' ? 'Verifying…' : 'Continue'}
            onPress={() => void handleVerifyCode()}
            pressedScale={NO_PRESS_SCALE}
          />
          <View style={styles.inlineActions}>
            <AuthTextAction
              disabled={isBusy}
              label={pending === 'send-email' ? 'Sending…' : 'Resend code'}
              onPress={() => void handleSendCode()}
            />
            <AuthTextAction
              disabled={isBusy}
              label="Change email"
              onPress={() => {
                setStep('email');
                setCode('');
                setMessage(null);
              }}
            />
          </View>
          {message ? <AuthErrorMessage message={message} /> : null}
        </View>
      </AuthFormScroll>
    );
  }

  if (step === 'email') {
    return (
      <AuthFormScroll>
        <View style={styles.form}>
          <View style={styles.formHeading}>
            <Text style={styles.title}>Enter your email</Text>
          </View>
          <TextInput
            accessibilityLabel="Email address"
            autoCapitalize="none"
            autoComplete="email"
            autoCorrect={false}
            editable={!isBusy}
            keyboardType="email-address"
            onChangeText={(value) => {
              setEmail(value);
              setMessage(null);
            }}
            onSubmitEditing={() => void handleSendCode()}
            placeholder="your@email.com"
            placeholderTextColor={colors.textMuted}
            returnKeyType="send"
            style={styles.input}
            textContentType="emailAddress"
            value={email}
          />
          <Button
            disabled={isBusy || email.trim().length === 0}
            label={pending === 'send-email' ? 'Sending…' : 'Continue'}
            onPress={() => void handleSendCode()}
            pressedScale={NO_PRESS_SCALE}
          />
          <AuthTextAction
            disabled={isBusy}
            label="Back"
            onPress={() => {
              setStep('methods');
              setMessage(null);
            }}
          />
          {message ? <AuthErrorMessage message={message} /> : null}
        </View>
      </AuthFormScroll>
    );
  }

  return (
    <AuthFormScroll>
      <View accessibilityLabel="Login or sign up options" style={styles.form}>
        <View style={styles.formHeading}>
          <Text style={styles.title}>Login or sign up</Text>
        </View>
        <View style={styles.methodList}>
          <Button
            disabled={isBusy}
            label="Continue with email"
            onPress={() => {
              setStep('email');
              setMessage(null);
            }}
            pressedScale={NO_PRESS_SCALE}
          />
          <AuthProviderButton
            disabled={isBusy}
            loading={pending === 'google'}
            onPress={() => void handleSocialLogin('google')}
            provider="google"
          />
          <AuthProviderButton
            disabled={isBusy}
            loading={pending === 'twitter'}
            onPress={() => void handleSocialLogin('twitter')}
            provider="twitter"
          />
        </View>
        {message ? <AuthErrorMessage message={message} /> : null}
      </View>
    </AuthFormScroll>
  );
}

const styles = StyleSheet.create({
  centeredState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  stateText: {
    ...typography.bodyCompact,
    marginTop: spacing.sm,
    color: colors.onLight,
    opacity: 0.7,
    textAlign: 'center',
  },
  form: {
    width: '100%',
    gap: spacing.sm,
  },
  formHeading: {
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  title: {
    color: colors.onLight,
    fontSize: 24,
    fontWeight: '600',
    lineHeight: 32,
    textAlign: 'center',
  },
  body: {
    ...typography.bodyCompact,
    marginTop: spacing.xxs,
    color: colors.onLight,
    opacity: 0.65,
    textAlign: 'center',
  },
  input: {
    minHeight: 56,
    borderWidth: 1,
    borderColor: colors.glassEdge,
    borderRadius: radii.md,
    backgroundColor: colors.textPrimary,
    paddingHorizontal: spacing.md,
    color: colors.onLight,
    ...typography.body,
  },
  codeInput: {
    fontSize: 24,
    fontWeight: '700',
    letterSpacing: 8,
    textAlign: 'center',
  },
  methodList: {
    alignSelf: 'stretch',
    gap: spacing.sm,
  },
  inlineActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  fullWidthAction: {
    alignSelf: 'stretch',
    marginTop: spacing.lg,
  },
});
