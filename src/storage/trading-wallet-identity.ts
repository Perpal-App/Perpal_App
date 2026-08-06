import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { ed25519 } from '@noble/curves/ed25519.js';
import { base58, base64 } from '@scure/base';

import {
  parseTradingWalletIdentity,
  serializeTradingWalletIdentity,
  type DerivedTradingWallet,
  type TradingWalletIdentity,
} from '@/wallet/trading/derivation';

const KEY_PREFIX = 'perpal.trading-wallet.identity.v1.';
const ACTIVATION_KEY_PREFIX = 'perpal.trading-wallet.activation.v1.';

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

async function activationKey(mainWalletAddress: string): Promise<string> {
  const ownerHash = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    mainWalletAddress,
  );
  return `${ACTIVATION_KEY_PREFIX}${ownerHash}`;
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

export async function readActivatedTradingWallet(
  mainWalletAddress: string,
): Promise<DerivedTradingWallet | null> {
  const value = await SecureStore.getItemAsync(
    await activationKey(mainWalletAddress),
  );

  if (value === null) {
    return null;
  }

  let secretKey: Uint8Array | null = null;

  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const identity = parseTradingWalletIdentity(JSON.stringify(parsed));

    if (identity === null || typeof parsed.seed !== 'string') {
      throw new Error('invalid activation record');
    }

    secretKey = base64.decode(parsed.seed);

    if (
      secretKey.length !== 32 ||
      base58.encode(ed25519.getPublicKey(secretKey)) !== identity.address
    ) {
      throw new Error('activation identity mismatch');
    }

    return { ...identity, secretKey };
  } catch {
    secretKey?.fill(0);
    throw new TradingWalletIdentityStorageError();
  }
}

export async function writeActivatedTradingWallet(
  mainWalletAddress: string,
  wallet: DerivedTradingWallet,
): Promise<void> {
  await SecureStore.setItemAsync(
    await activationKey(mainWalletAddress),
    JSON.stringify({
      address: wallet.address,
      generation: wallet.generation,
      version: wallet.version,
      seed: base64.encode(wallet.secretKey),
    }),
  );
  await writeTradingWalletIdentity(mainWalletAddress, wallet);
}
