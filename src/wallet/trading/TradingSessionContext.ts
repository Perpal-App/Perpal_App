import { createContext, useContext } from 'react';

import type { GatewayRequestSigner } from '@/integrations/api/gatewayClient';
import type { TradingWalletIdentity } from '@/wallet/trading/derivation';
import type { TradingWalletRotationPlan } from '@/wallet/trading/rotationSafety';

export type TradingSessionStatus =
  | 'waiting-for-wallet'
  | 'restoring'
  | 'inactive'
  | 'activating'
  | 'rotating'
  | 'ready'
  | 'recovery-required'
  | 'error';

export type TradingSessionRecovery = {
  readonly reason: 'mismatch' | 'version-upgrade';
  readonly recorded: TradingWalletIdentity;
  readonly derived: TradingWalletIdentity;
};

export type TradingSession = {
  readonly status: TradingSessionStatus;
  readonly mainWalletAddress: string | null;
  readonly address: string | null;
  readonly signer: GatewayRequestSigner | null;
  readonly generation: number;
  readonly recovery: TradingSessionRecovery | null;
  readonly rotationPending: boolean;
  readonly error: string | null;
  readonly activate: () => Promise<void>;
  readonly prepareRotation: () => Promise<TradingWalletRotationPlan>;
  readonly recover: () => Promise<void>;
  readonly retryRestore: () => void;
  readonly rotate: (plan: TradingWalletRotationPlan) => Promise<void>;
};

export const TradingSessionContext = createContext<TradingSession | null>(null);

export function useTradingSession(): TradingSession {
  const session = useContext(TradingSessionContext);
  if (session === null) {
    throw new Error('useTradingSession must be used inside TradingSessionProvider.');
  }
  return session;
}
