import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

const KEY_PREFIX = 'perpal.trading-wallet.rotation.v1.';

export type TradingWalletRotationCheckpoint = {
  readonly createdAtMs: number;
  readonly destinationGeneration: number;
  readonly destinationWalletAddress: string;
  readonly mainWalletAddress: string;
  readonly phase: 'migrating-tokens' | 'sweeping-sol' | 'complete';
  readonly sourceWalletAddress: string;
  readonly submitted: {
    readonly idempotencyKey: string;
    readonly signature: string;
    readonly signedTransactionBase64: string;
  } | null;
  readonly updatedAtMs: number;
  readonly version: 1;
};

export async function readTradingWalletRotation(
  mainWalletAddress: string,
): Promise<TradingWalletRotationCheckpoint | null> {
  const value = await SecureStore.getItemAsync(await key(mainWalletAddress));
  if (value === null) return null;

  try {
    const record = JSON.parse(value) as unknown;
    if (!valid(record, mainWalletAddress)) throw new Error('invalid checkpoint');
    return record;
  } catch {
    throw new Error('Stored private-wallet rotation state is invalid.');
  }
}

export async function writeTradingWalletRotation(
  record: TradingWalletRotationCheckpoint,
): Promise<void> {
  if (!valid(record, record.mainWalletAddress)) {
    throw new Error('Private-wallet rotation state is invalid.');
  }
  await SecureStore.setItemAsync(
    await key(record.mainWalletAddress),
    JSON.stringify(record),
  );
  console.info('[Perpal recovery]', JSON.stringify({
    event: 'checkpoint',
    operation: 'trading_wallet_rotation',
    phase: record.phase,
    submitted: record.submitted !== null,
  }));
}

export async function removeTradingWalletRotation(
  mainWalletAddress: string,
): Promise<void> {
  await SecureStore.deleteItemAsync(await key(mainWalletAddress));
}

async function key(mainWalletAddress: string): Promise<string> {
  const digest = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    mainWalletAddress,
  );
  return `${KEY_PREFIX}${digest}`;
}

function valid(
  value: unknown,
  mainWalletAddress: string,
): value is TradingWalletRotationCheckpoint {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const submitted = record.submitted;
  return record.version === 1 &&
    record.mainWalletAddress === mainWalletAddress &&
    validAddress(record.sourceWalletAddress) &&
    validAddress(record.destinationWalletAddress) &&
    Number.isSafeInteger(record.destinationGeneration) &&
    Number(record.destinationGeneration) > 0 &&
    ['migrating-tokens', 'sweeping-sol', 'complete'].includes(String(record.phase)) &&
    Number.isSafeInteger(record.createdAtMs) &&
    Number.isSafeInteger(record.updatedAtMs) &&
    (submitted === null || validSubmission(submitted));
}

function validSubmission(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return typeof record.idempotencyKey === 'string' && record.idempotencyKey.length > 0 &&
    typeof record.signature === 'string' && record.signature.length > 0 &&
    typeof record.signedTransactionBase64 === 'string' && record.signedTransactionBase64.length > 0;
}

function validAddress(value: unknown): value is string {
  return typeof value === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/u.test(value);
}
