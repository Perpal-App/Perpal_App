import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ImageSourcePropType,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { Button } from '@/components/ui/Button';
import {
  AuthErrorMessage,
  AuthFormScroll,
  AuthTextAction,
  PrivyFooter,
} from '@/features/auth/components/AuthFormPrimitives';
import { AuthProviderButton } from '@/features/auth/components/AuthProviderButton';
import { PrivyOtpInput } from '@/features/auth/components/PrivyOtpInput';
import {
  usePrivyAuth,
  type SocialAuthProvider,
} from '@/integrations/privy/usePrivyAuth';
import { colors, spacing, typography } from '@/theme/tokens';

type AuthFlowCardProps = {
  onAuthenticated: () => void;
};

type AuthStep = 'methods' | 'otp';
type PendingAction = 'send-email' | 'verify-email' | SocialAuthProvider | 'logout';

const NO_PRESS_SCALE = 1;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const OTP_LENGTH = 6;
const RESEND_DELAY_SECONDS = 30;
const MESSAGE_DISMISS_MS = 5000;
const PRIVY_BORDER = '#E4E2F2';
const PRIVY_ERROR = '#EF4444';
// Surfaces carry a faint violet wash of the brand accent so the light card
// reads as native rather than plain white.
const PRIVY_INPUT = '#F4F2FC';
const PRIVY_PLACEHOLDER = '#9498B8';
const PRIVY_TEXT = '#040217';
const loginLogo = require('../../../../assets/AppLogos/perpal_logo_black.png') as ImageSourcePropType;

/**
 * Accurate inline recreation of Privy's default login flow in Perpal's existing
 * 40% sheet. Email entry and social methods share the first card; only a
 * successful code request swaps its inner content to confirmation-code entry.
 */
export function AuthFlowCard({ onAuthenticated }: AuthFlowCardProps) {
  const auth = usePrivyAuth();
  const [step, setStep] = useState<AuthStep>('methods');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [emailFocused, setEmailFocused] = useState(false);
  const [emailError, setEmailError] = useState(false);
  const [resendRemaining, setResendRemaining] = useState(0);
  // Once the unauthenticated flow has appeared, keep that exact subtree mounted
  // through Privy's transient readiness/user changes during an OAuth handoff.
  // The parent success transition remains the only post-login replacement.
  const [hasPresentedAuthFlow, setHasPresentedAuthFlow] = useState(
    auth.isReady && !auth.isAuthenticated,
  );

  const hasPendingAuthFlow = pending !== null && pending !== 'logout';
  const keepAuthFlowMounted = hasPresentedAuthFlow || hasPendingAuthFlow;
  const isBusy =
    !auth.isReady ||
    auth.initializationError !== null ||
    pending !== null ||
    auth.emailState.status === 'sending-code' ||
    auth.emailState.status === 'submitting-code' ||
    auth.oauthState.status === 'loading';

  useEffect(() => {
    if (auth.isReady && !auth.isAuthenticated) {
      setHasPresentedAuthFlow(true);
    }
  }, [auth.isAuthenticated, auth.isReady]);

  useEffect(() => {
    if (resendRemaining <= 0) {
      return;
    }

    const timer = setTimeout(
      () => setResendRemaining((remaining) => Math.max(remaining - 1, 0)),
      1000,
    );

    return () => clearTimeout(timer);
  }, [resendRemaining]);

  // Alerts are transient: dismiss the banner (and any red input state) shortly
  // after it appears so a stale error never lingers on screen.
  useEffect(() => {
    if (!message) {
      return;
    }

    const timer = setTimeout(() => {
      setMessage(null);
      setEmailError(false);
    }, MESSAGE_DISMISS_MS);

    return () => clearTimeout(timer);
  }, [message]);

  if (auth.initializationError && !keepAuthFlowMounted) {
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

  if (!auth.isReady && !keepAuthFlowMounted) {
    return (
      <View accessibilityLiveRegion="polite" style={styles.centeredState}>
        <ActivityIndicator color={colors.accent} />
        <Text style={styles.stateText}>Preparing secure sign in…</Text>
      </View>
    );
  }

  if (auth.isAuthenticated && !keepAuthFlowMounted) {
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
      setEmailError(true);
      setMessage('Email address is incorrect.');
      return;
    }

    setPending('send-email');
    setEmailError(false);
    setMessage(null);

    try {
      await auth.sendEmailCode(normalizedEmail);
      setEmail(normalizedEmail);
      setCode('');
      setResendRemaining(RESEND_DELAY_SECONDS);
      setStep('otp');
    } catch (error) {
      const kind = auth.getErrorKind(error);

      setEmailError(true);
      setMessage(
        kind === 'configuration'
          ? 'Email sign-in is not enabled for this app.'
          : kind === 'rate-limited'
            ? 'Too many attempts. Please wait a moment and try again.'
            : kind === 'network'
              ? 'Check your connection and try again.'
              : 'We could not send a code. Please try again.',
      );
    } finally {
      setPending(null);
    }
  };

  const handleVerifyCode = async (verificationCode = code) => {
    if (verificationCode.length !== OTP_LENGTH || pending !== null) {
      if (verificationCode.length !== OTP_LENGTH) {
        setMessage('Enter the 6-digit code from your email.');
      }
      return;
    }

    setPending('verify-email');
    setMessage(null);

    try {
      const authenticated = await auth.verifyEmailCode({
        email,
        code: verificationCode,
      });

      if (authenticated) {
        onAuthenticated();
      } else {
        setMessage('Invalid code. Request a new code and try again.');
      }
    } catch (error) {
      const kind = auth.getErrorKind(error);

      setMessage(
        kind === 'network'
          ? 'Check your connection and try again.'
          : kind === 'rate-limited'
            ? 'Too many attempts. Request a new code in a moment.'
            : 'That code is invalid or has expired. Please try again.',
      );
    } finally {
      setPending(null);
    }
  };

  const handleSocialLogin = async (provider: SocialAuthProvider) => {
    setPending(provider);
    setEmailError(false);
    setMessage(null);

    try {
      const authenticated = await auth.loginWithSocial({ provider });

      if (authenticated) {
        onAuthenticated();
      }
    } catch (error) {
      const kind = auth.getErrorKind(error);

      if (kind !== 'cancelled') {
        const providerName = provider === 'twitter' ? 'X' : 'Google';

        setMessage(
          kind === 'configuration'
            ? 'Social sign-in is not enabled for this app.'
            : kind === 'network'
              ? 'Check your connection and try again.'
              : kind === 'rate-limited'
                ? 'Too many attempts. Please wait a moment and try again.'
                : `Could not continue with ${providerName}. Please try again.`,
        );
      }
    } finally {
      setPending(null);
    }
  };

  if (step === 'otp') {
    const resendDisabled = isBusy || resendRemaining > 0;
    const resendLabel =
      resendRemaining > 0 ? `Resend in ${resendRemaining}s` : 'Resend code';

    return (
      <AuthFormScroll>
        <View style={styles.screen}>
          <View style={styles.form}>
            <View style={styles.formHeading}>
              <Text style={styles.title}>Enter confirmation code</Text>
              <Text style={styles.body}>
                Please check {email} for a message with your login code.
              </Text>
            </View>
            <PrivyOtpInput
              editable={!isBusy}
              error={message !== null}
              onChangeText={(value) => {
                setCode(value);
                setMessage(null);
              }}
              onComplete={(value) => void handleVerifyCode(value)}
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
                disabled={resendDisabled}
                label={resendLabel}
                onPress={() => void handleSendCode()}
              />
              <AuthTextAction
                disabled={isBusy}
                label="Change email"
                onPress={() => {
                  setStep('methods');
                  setCode('');
                  setEmailError(false);
                  setMessage(null);
                }}
              />
            </View>
            {message ? <AuthErrorMessage message={message} /> : null}
          </View>
          <PrivyFooter />
        </View>
      </AuthFormScroll>
    );
  }

  return (
    <AuthFormScroll>
      <View accessibilityLabel="Login or sign up options" style={styles.screen}>
        <View style={styles.form}>
          <View style={styles.landingHeading}>
            <Image
              accessibilityIgnoresInvertColors
              accessible={false}
              resizeMode="contain"
              source={loginLogo}
              style={styles.loginLogo}
            />
            <Text style={styles.title}>Log in or sign up</Text>
          </View>
          <View style={styles.methodList}>
            <View
              style={[
                styles.emailInputShell,
                emailFocused && styles.focusedInput,
                emailError && styles.errorInput,
              ]}
            >
              <MailIcon />
              <TextInput
                accessibilityLabel="Email address"
                autoCapitalize="none"
                autoComplete="email"
                autoCorrect={false}
                editable={!isBusy}
                keyboardType="email-address"
                onBlur={() => setEmailFocused(false)}
                onChangeText={(value) => {
                  setEmail(value);
                  setEmailError(false);
                  setMessage(null);
                }}
                onFocus={() => setEmailFocused(true)}
                onSubmitEditing={() => void handleSendCode()}
                placeholder="your@email.com"
                placeholderTextColor={PRIVY_PLACEHOLDER}
                returnKeyType="send"
                style={styles.emailInput}
                textContentType="emailAddress"
                value={email}
              />
              <AuthTextAction
                disabled={isBusy || email.trim().length === 0}
                label={pending === 'send-email' ? 'Sending…' : 'Submit'}
                onPress={() => void handleSendCode()}
              />
            </View>
            <Text style={styles.socialLabel}>Or continue with</Text>
            <View style={styles.socialRow}>
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
          </View>
          {message ? <AuthErrorMessage message={message} /> : null}
        </View>
        <PrivyFooter />
      </View>
    </AuthFormScroll>
  );
}

function MailIcon() {
  return (
    <Svg height={22} viewBox="0 0 24 24" width={22}>
      <Path
        d="M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z"
        fill="none"
        stroke={PRIVY_PLACEHOLDER}
        strokeLinejoin="round"
        strokeWidth={2}
      />
      <Path
        d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"
        fill="none"
        stroke={PRIVY_PLACEHOLDER}
        strokeLinejoin="round"
        strokeWidth={2}
      />
    </Svg>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    justifyContent: 'space-between',
    gap: spacing.xs,
  },
  centeredState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  stateText: {
    ...typography.bodyCompact,
    marginTop: spacing.sm,
    color: PRIVY_TEXT,
    opacity: 0.7,
    textAlign: 'center',
  },
  form: {
    width: '100%',
    gap: spacing.xl,
  },
  landingHeading: {
    alignItems: 'center',
    gap: spacing.md,
  },
  loginLogo: {
    width: 52,
    height: 52,
    borderRadius: 14,
  },
  formHeading: {
    alignItems: 'center',
    marginBottom: spacing.xxs,
  },
  title: {
    color: PRIVY_TEXT,
    fontSize: 24,
    fontWeight: '600',
    lineHeight: 32,
    textAlign: 'center',
  },
  body: {
    ...typography.bodyCompact,
    marginTop: spacing.xxs,
    color: '#64668B',
    textAlign: 'center',
  },
  methodList: {
    alignSelf: 'stretch',
    gap: spacing.md,
  },
  socialLabel: {
    marginTop: spacing.xs,
    color: '#64668B',
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 20,
    textAlign: 'center',
  },
  socialRow: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.xl,
    marginTop: spacing.sm,
  },
  emailInputShell: {
    height: 60,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 2,
    borderColor: PRIVY_BORDER,
    borderRadius: 14,
    backgroundColor: PRIVY_INPUT,
    paddingHorizontal: spacing.md,
  },
  focusedInput: {
    borderColor: colors.accent,
  },
  errorInput: {
    borderColor: PRIVY_ERROR,
  },
  emailInput: {
    flex: 1,
    color: PRIVY_TEXT,
    fontSize: 18,
    lineHeight: 24,
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
