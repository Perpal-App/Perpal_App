import { createContext, useContext } from 'react';

export type AuthHandoff = {
  /**
   * True when Privy has confirmed a brand-new sign-in during this session and
   * the user has not yet acknowledged the success confirmation. The root guard
   * keeps the auth route mounted while this is true.
   */
  isAwaitingEntry: boolean;
  /** Acknowledge the success card and enter the authenticated app. */
  confirmEntry: () => void;
};

const AuthHandoffContext = createContext<AuthHandoff>({
  isAwaitingEntry: false,
  confirmEntry: () => {},
});

export const AuthHandoffProvider = AuthHandoffContext.Provider;

export function useAuthHandoff() {
  return useContext(AuthHandoffContext);
}
