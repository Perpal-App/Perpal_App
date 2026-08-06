import { base58 } from '@scure/base';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

const PREFIX = 'perpal.umbra.private-exit.v1.';

export type PrivateExitPhase =
  | 'depositing'
  | 'scanning'
  | 'proving'
  | 'relaying'
  | 'complete';

export type PrivateExitRecord = {
  readonly version: 1;
  readonly id: string;
  readonly sourceWalletAddress: string;
  readonly destinationAddress: string;
  readonly mint: string;
  readonly symbol: 'USDC' | 'USDT';
  readonly amountBaseUnits: string;
  readonly phase: PrivateExitPhase;
  readonly generationIndex: string | null;
  readonly excludedNoteIds: readonly string[];
  readonly scanStartLeafCounts: readonly string[] | null;
  readonly populateSignature: string | null;
  readonly depositSignature: string | null;
  readonly relayRequestId: string | null;
  readonly claimSignature: string | null;
  readonly noteAmountBaseUnits: string | null;
  readonly relayerFixedFeeLamports: string | null;
  readonly errorCode: string | null;
  readonly updatedAtMs: number;
};

export async function readPrivateExitRecord(
  sourceWalletAddress: string,
): Promise<PrivateExitRecord | null> {
  const value = await SecureStore.getItemAsync(await key(sourceWalletAddress));
  if (value === null) return null;
  const record = parseRecord(value);
  if (record === null || record.sourceWalletAddress !== sourceWalletAddress) {
    throw new Error('Stored private-withdraw recovery state is invalid.');
  }
  return record;
}

export async function writePrivateExitRecord(
  record: PrivateExitRecord,
): Promise<void> {
  if (parseRecord(JSON.stringify(record)) === null) {
    throw new Error('Private-withdraw recovery state is invalid.');
  }
  await SecureStore.setItemAsync(
    await key(record.sourceWalletAddress),
    JSON.stringify(record),
  );
}

function parseRecord(value: string): PrivateExitRecord | null {
  try {
    const record = JSON.parse(value) as Record<string, unknown>;
    const scanStartLeafCounts = record.scanStartLeafCounts ?? null;
    if (
      record.version !== 1 ||
      typeof record.id !== 'string' ||
      !isAddress(record.sourceWalletAddress) ||
      !isAddress(record.destinationAddress) ||
      !isAddress(record.mint) ||
      (record.symbol !== 'USDC' && record.symbol !== 'USDT') ||
      !unsigned(record.amountBaseUnits) ||
      !['depositing', 'scanning', 'proving', 'relaying', 'complete'].includes(String(record.phase)) ||
      !nullableString(record.generationIndex) ||
      !Array.isArray(record.excludedNoteIds) ||
      !record.excludedNoteIds.every((entry) => typeof entry === 'string') ||
      !nullableScanBoundary(scanStartLeafCounts) ||
      !nullableString(record.populateSignature) ||
      !nullableString(record.depositSignature) ||
      !nullableString(record.relayRequestId) ||
      !nullableString(record.claimSignature) ||
      !nullableUnsigned(record.noteAmountBaseUnits) ||
      !nullableUnsigned(record.relayerFixedFeeLamports) ||
      !nullableString(record.errorCode) ||
      !Number.isSafeInteger(record.updatedAtMs)
    ) {
      return null;
    }
    return { ...record, scanStartLeafCounts } as unknown as PrivateExitRecord;
  } catch {
    return null;
  }
}

async function key(address: string): Promise<string> {
  return `${PREFIX}${await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    address,
  )}`;
}

function isAddress(value: unknown): value is string {
  try {
    return typeof value === 'string' && base58.decode(value).length === 32;
  } catch {
    return false;
  }
}
function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}
function unsigned(value: unknown): value is string {
  return typeof value === 'string' && /^\d+$/u.test(value);
}
function nullableUnsigned(value: unknown): value is string | null {
  return value === null || unsigned(value);
}
function nullableScanBoundary(value: unknown): value is readonly string[] | null {
  return value === null || (
    Array.isArray(value) &&
    value.every((entry) => typeof entry === 'string' && /^\d+:\d+$/u.test(entry))
  );
}
