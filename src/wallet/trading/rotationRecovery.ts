import { ed25519 } from '@noble/curves/ed25519.js';
import { base58 } from '@scure/base';

import type { AppConfig } from '@/config/appConfig';
import type { GatewayRequestSigner } from '@/integrations/api/gatewayClient';
import {
  writeActivatedTradingWallet,
  type ActivatedTradingWallet,
} from '@/storage/trading-wallet-identity';
import {
  DERIVATION_VERSION,
  deriveRotatedTradingWallet,
  type DerivedTradingWallet,
  type TradingWalletIdentity,
} from '@/wallet/trading/derivation';
import {
  finalizeTradingWalletRotation,
  reconcileTradingWalletRotation,
  TradingWalletRotationError,
} from '@/wallet/trading/rotationSafety';

export type RecoveryCandidate = {
  readonly rootSecretKey: Uint8Array;
  readonly wallet: DerivedTradingWallet;
};

export function signerForDerivedWallet(
  wallet: Pick<DerivedTradingWallet, 'address' | 'secretKey'>,
): GatewayRequestSigner {
  const publicKey = base58.decode(wallet.address);
  return {
    publicKey,
    sign: async (message) => ed25519.sign(message, wallet.secretKey),
  };
}

/** Recovers a recorded generation when it belongs to the retained deterministic root. */
export function deriveRecordedTradingWallet(
  candidate: RecoveryCandidate,
  mainWalletAddress: string,
  recorded: TradingWalletIdentity,
): DerivedTradingWallet | null {
  if (recorded.generation === 0) {
    const secretKey = candidate.rootSecretKey.slice();
    if (base58.encode(ed25519.getPublicKey(secretKey)) !== recorded.address) {
      secretKey.fill(0);
      return null;
    }
    return { ...recorded, secretKey };
  }
  if (recorded.version !== DERIVATION_VERSION) return null;
  const wallet = deriveRotatedTradingWallet(
    candidate.rootSecretKey,
    mainWalletAddress,
    recorded.generation,
  );
  if (wallet.address === recorded.address) return wallet;
  wallet.secretKey.fill(0);
  return null;
}

/**
 * Finishes only the already-confirmed part of a saved rotation. It never signs
 * or submits while restoring the app; any remaining migration requires the
 * user's explicit Resume confirmation.
 */
export async function reconcileActivatedTradingWallet(input: {
  readonly activated: ActivatedTradingWallet;
  readonly config: AppConfig;
  readonly mainWalletAddress: string;
}): Promise<{
  readonly rotationPending: boolean;
  readonly wallet: ActivatedTradingWallet;
}> {
  const signer = signerForDerivedWallet(input.activated);
  const recovery = await reconcileTradingWalletRotation({
    config: input.config,
    mainWalletAddress: input.mainWalletAddress,
    signer,
    tradingWalletAddress: input.activated.address,
  });
  if (recovery.status === 'none') {
    return { rotationPending: false, wallet: input.activated };
  }
  if (recovery.status === 'needs-resume') {
    if (recovery.checkpoint.sourceWalletAddress !== input.activated.address) {
      throw new TradingWalletRotationError(
        'The destination wallet became active before every source asset was migrated.',
      );
    }
    return { rotationPending: true, wallet: input.activated };
  }

  if (input.activated.address === recovery.checkpoint.destinationWalletAddress) {
    await finalizeTradingWalletRotation(input.mainWalletAddress);
    return { rotationPending: false, wallet: input.activated };
  }
  if (input.activated.address !== recovery.checkpoint.sourceWalletAddress) {
    throw new TradingWalletRotationError('The confirmed rotation identity could not be reconciled.');
  }

  const next = deriveRotatedTradingWallet(
    input.activated.rootSecretKey,
    input.mainWalletAddress,
    recovery.checkpoint.destinationGeneration,
  );
  if (next.address !== recovery.checkpoint.destinationWalletAddress) {
    next.secretKey.fill(0);
    throw new TradingWalletRotationError('The confirmed destination does not match the saved root.');
  }
  await writeActivatedTradingWallet(
    input.mainWalletAddress,
    next,
    input.activated.rootSecretKey,
  );
  await finalizeTradingWalletRotation(input.mainWalletAddress);
  input.activated.secretKey.fill(0);
  return {
    rotationPending: false,
    wallet: { ...next, rootSecretKey: input.activated.rootSecretKey },
  };
}
