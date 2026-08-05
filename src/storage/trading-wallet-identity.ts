import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

import {
  parseTradingWalletIdentity,
  serializeTradingWalletIdentity,
  type TradingWalletIdentity,
} from '@/wallet/trading/derivation';

const KEY_PREFIX = 'perpal.trading-wallet.identity.v1.';

export class TradingWalletIdentityStorageError extends Error {
  constructor() {
    super('Stored trading-wallet identity is invalid.');
    this.name = 'TradingWalletIdentityStorageError';
  }
}

async function identityKey(mainWalletAddress: string): Promise<string> {
  const ownerHash = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    mainWalletAddress,
  );
  return `${KEY_PREFIX}${ownerHash}`;
}

export async function readTradingWalletIdentity(
  mainWalletAddress: string,
): Promise<TradingWalletIdentity | null> {
  const value = await SecureStore.getItemAsync(
    await identityKey(mainWalletAddress),
  );

  if (value === null) {
    return null;
  }

  const identity = parseTradingWalletIdentity(value);

  if (identity === null) {
    throw new TradingWalletIdentityStorageError();
  }

  return identity;
}

export async function writeTradingWalletIdentity(
  mainWalletAddress: string,
  identity: TradingWalletIdentity,
): Promise<void> {
  await SecureStore.setItemAsync(
    await identityKey(mainWalletAddress),
    serializeTradingWalletIdentity(identity),
  );
}
