import {
  useLoginWithEmail,
  useLoginWithOAuth,
  usePrivy,
  type OAuthFlowState,
  type OtpFlowState,
} from '@privy-io/expo';

export type SocialAuthProvider = 'google' | 'twitter';

export type EmailVerificationInput = {
  email: string;
  code: string;
};

export type SocialLoginInput = {
  provider: SocialAuthProvider;
};

type PrivyAuthErrorKind =
  | 'cancelled'
  | 'configuration'
  | 'network'
  | 'rate-limited'
  | 'unavailable'
  | 'unknown';

type PrivyAuth = {
  isReady: boolean;
  isAuthenticated: boolean;
  initializationError: Error | null;
  emailState: OtpFlowState;
  oauthState: OAuthFlowState;
  sendEmailCode: (email: string) => Promise<void>;
  verifyEmailCode: (input: EmailVerificationInput) => Promise<boolean>;
  loginWithSocial: (input: SocialLoginInput) => Promise<boolean>;
  getErrorKind: (error: unknown) => PrivyAuthErrorKind;
  logout: () => Promise<void>;
};

type PrivyErrorMetadata = {
  code: string | undefined;
  status: number | undefined;
  name: string | undefined;
};

function getPrivyErrorMetadata(error: unknown): PrivyErrorMetadata {
  if (typeof error !== 'object' || error === null) {
    return { code: undefined, status: undefined, name: undefined };
  }

  const candidate = error as Record<string, unknown>;

  return {
    code: typeof candidate.code === 'string' ? candidate.code : undefined,
    status: typeof candidate.status === 'number' ? candidate.status : undefined,
    name: typeof candidate.name === 'string' ? candidate.name : undefined,
  };
}

/**
 * Reduce SDK errors to stable categories that are safe for feature UI. In
 * development, log only non-sensitive metadata: never the email address, raw
 * response, or SDK message.
 */
function getErrorKind(error: unknown): PrivyAuthErrorKind {
  const metadata = getPrivyErrorMetadata(error);
  const code = metadata.code?.toLowerCase() ?? '';

  if (__DEV__) {
    console.warn('[Privy auth failure]', {
      code: metadata.code ?? 'unknown',
      status: metadata.status ?? 'unknown',
      name: metadata.name ?? 'unknown',
    });
  }

  if (code.endsWith('_was_cancelled_by_user') || code === 'mfa_canceled') {
    return 'cancelled';
  }

  if (
    code === 'invalid_native_app_id' ||
    code === 'configuration_error' ||
    code.includes('invalid_client') ||
    code.includes('client_not_found') ||
    code.includes('url_scheme') ||
    code.includes('allowed_origin') ||
    metadata.status === 401 ||
    metadata.status === 403
  ) {
    return 'configuration';
  }

  if (metadata.status === 429) {
    return 'rate-limited';
  }

  if (
    code.includes('network') ||
    code.includes('timeout') ||
    error instanceof TypeError
  ) {
    return 'network';
  }

  if (metadata.status !== undefined && metadata.status >= 500) {
    return 'unavailable';
  }

  return 'unknown';
}

/**
 * Narrow headless Privy adapter used by the inline auth UI.
 *
 * Feature components never import SDK hooks directly. The adapter owns provider
 * literals (`twitter` is Privy's ID for X), the OAuth return path, and safe
 * error categorization. Signup remains enabled so each method works as a unified
 * login-or-sign-up action. OAuth cancellation is thrown by SDK 0.70.6 and is
 * categorized so the UI can dismiss it quietly.
 */
export function usePrivyAuth(): PrivyAuth {
  const { error, isReady, logout, user } = usePrivy();
  const emailLogin = useLoginWithEmail();
  const oauthLogin = useLoginWithOAuth();

  const sendEmailCode = async (email: string) => {
    await emailLogin.sendCode({ email });
  };

  const verifyEmailCode = async ({
    email,
    code,
  }: EmailVerificationInput) => {
    const authenticatedUser = await emailLogin.loginWithCode({ email, code });

    return authenticatedUser !== undefined;
  };

  const loginWithSocial = async ({ provider }: SocialLoginInput) => {
    const authenticatedUser = await oauthLogin.login({
      provider,
      // Route groups are omitted from Expo Router URLs; `(auth)/access.tsx` is
      // reached at `/access`, yielding the deep link `perpal:///access`.
      redirectUri: '/access',
    });

    return authenticatedUser !== undefined;
  };

  return {
    isReady,
    isAuthenticated: user !== null,
    initializationError: error,
    emailState: emailLogin.state,
    oauthState: oauthLogin.state,
    sendEmailCode,
    verifyEmailCode,
    loginWithSocial,
    getErrorKind,
    logout,
  };
}
