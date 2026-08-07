import { useEffect, useState } from 'react';
import {
  Image,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ImageSourcePropType,
} from 'react-native';

import { IOSLoader } from '@/components/feedback/IOSLoader';
import { Button } from '@/components/ui/Button';
import { AuthMailIcon } from '@/features/auth/components/AuthMailIcon';
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
import { colors, fonts, spacing, typography } from '@/theme/tokens';

type AuthStep = 'methods' | 'otp';
type PendingAction = 'send-email' | 'verify-email' | SocialAuthProvider;

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
 * The root auth guard observes successful login and owns the route transition.
 */
export function AuthFlowCard() {
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
  // The root guard performs the post-login route replacement once the session
  // becomes authoritative.
  const shouldPresentAuthFlow = auth.isReady && !auth.isAuthenticated;
  const [hasPresentedAuthFlow, setHasPresentedAuthFlow] = useState(
    shouldPresentAuthFlow,
  );

  if (shouldPresentAuthFlow && !hasPresentedAuthFlow) {
    setHasPresentedAuthFlow(true);
  }

  const keepAuthFlowMounted = hasPresentedAuthFlow || pending !== null;
  const isBusy =
    !auth.isReady ||
    auth.initializationError !== null ||
    pending !== null ||
    auth.emailState.status === 'sending-code' ||
    auth.emailState.status === 'submitting-code' ||
    auth.oauthState.status === 'loading';

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
      <IOSLoader
        accessibilityLabel="Preparing secure sign in"
        fill
        size="large"
      />
    );
  }

  // A restored authenticated `/access` route can survive for one transition
  // frame while the root Stack remounts. Never expose auth UI or logout here.
  if (auth.isAuthenticated && !keepAuthFlowMounted) {
    return <IOSLoader accessibilityLabel="Opening Home" fill size="large" />;
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

      if (!authenticated) {
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
      await auth.loginWithSocial({ provider });
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
              label="Continue"
              loading={pending === 'verify-email'}
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
              <AuthMailIcon color={PRIVY_PLACEHOLDER} />
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
                label="Submit"
                loading={pending === 'send-email'}
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
    fontFamily: fonts.semiBold,
    fontSize: 24,
    lineHeight: 36,
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
    fontFamily: fonts.medium,
    fontSize: 14,
    lineHeight: 21,
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
    fontFamily: fonts.regular,
    fontSize: 18,
    // No lineHeight on an input: Android derives the caret box from the font's
    // own metrics, and forcing a shorter line clips the typed text.
  },
  inlineActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
});
