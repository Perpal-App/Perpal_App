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

type PrivyAuth = {
  isReady: boolean;
  isAuthenticated: boolean;
  initializationError: Error | null;
  emailState: OtpFlowState;
  oauthState: OAuthFlowState;
  sendEmailCode: (email: string) => Promise<void>;
  verifyEmailCode: (input: EmailVerificationInput) => Promise<boolean>;
  loginWithSocial: (input: SocialLoginInput) => Promise<boolean>;
  logout: () => Promise<void>;
};

/**
 * Narrow Privy adapter used by auth UI.
 *
 * Feature components never import SDK hooks directly. The adapter owns provider
 * literals (`twitter` is Privy's ID for X) and the OAuth return path. Signup is
 * left enabled so each method works as a unified login-or-sign-up action.
 * Success is returned only when Privy resolves with a concrete user; a dismissed
 * OAuth browser can resolve without one and is treated as quiet cancellation.
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
    logout,
  };
}
