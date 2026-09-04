import { base58, base64 } from '@scure/base';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

import { hasCompletedPrivateWalletFunding } from '@/integrations/umbra/privateFundingState';

const MASTER_SEED_PREFIX = 'perpal.umbra.master-seed.v1.';
const OPERATION_PREFIX = 'perpal.umbra.private-funding.v1.';

export type PrivateFundingPhase =
  | 'depositing'
  | 'scanning'
  | 'proving'
  | 'relaying'
  | 'fee-funding'
  | 'provider-depositing'
  | 'complete';

export type PrivateFundingDestination = 'private' | 'pacifica';

export type PrivateFundingRecord = {
  readonly version: 2;
  readonly id: string;
  readonly mainWalletAddress: string;
  readonly tradingWalletAddress: string;
  readonly provider: 'pacifica';
  readonly destination: PrivateFundingDestination;
  readonly mint: string;
  readonly symbol: 'USDC' | 'USDT';
  readonly amountBaseUnits: string;
  readonly phase: PrivateFundingPhase;
  readonly generationIndex: string | null;
  readonly excludedNoteIds: readonly string[];
  readonly scanStartLeafCounts: readonly string[] | null;
  readonly populateSignature: string | null;
  readonly depositSignature: string | null;
  readonly relayRequestId: string | null;
  readonly claimSignature: string | null;
  readonly noteAmountBaseUnits: string | null;
  readonly relayerFixedFeeLamports: string | null;
  readonly feeFundingLamports: string | null;
  readonly feeFundingWrapSignature: string | null;
  readonly feeFundingGenerationIndex: string | null;
  readonly feeFundingExcludedNoteIds: readonly string[];
  readonly feeFundingScanStartLeafCounts: readonly string[] | null;
  readonly feeFundingPopulateSignature: string | null;
  readonly feeFundingDepositSignature: string | null;
  readonly feeFundingRelayRequestId: string | null;
  readonly feeFundingSignature: string | null;
  readonly feeFundingNoteAmountLamports: string | null;
  readonly feeFundingRelayerFixedFeeLamports: string | null;
  readonly providerDepositExpiresAtMs: number | null;
  readonly providerDepositIdempotencyKey: string | null;
  readonly providerDepositSignature: string | null;
  readonly providerDepositSignedTransactionBase64: string | null;
  readonly errorCode: string | null;
  readonly updatedAtMs: number;
};

export async function readUmbraMasterSeed(
  mainWalletAddress: string,
): Promise<Uint8Array | null> {
  const encoded = await SecureStore.getItemAsync(
    await storageKey(MASTER_SEED_PREFIX, mainWalletAddress),
  );
  if (encoded === null) return null;

  const seed = base64.decode(encoded);
  if (seed.length !== 64) {
    seed.fill(0);
    throw new Error('Stored Umbra recovery material is invalid.');
  }
  return seed;
}

export async function writeUmbraMasterSeed(
  mainWalletAddress: string,
  seed: Uint8Array,
): Promise<void> {
  if (seed.length !== 64) {
    throw new Error('Umbra recovery material is invalid.');
  }
  await SecureStore.setItemAsync(
    await storageKey(MASTER_SEED_PREFIX, mainWalletAddress),
    base64.encode(seed),
  );
}

export async function readPrivateFundingRecord(
  mainWalletAddress: string,
): Promise<PrivateFundingRecord | null> {
  const value = await SecureStore.getItemAsync(
    await storageKey(OPERATION_PREFIX, mainWalletAddress),
  );
  if (value === null) return null;

  const parsed = parseRecord(value);
  if (parsed === null || parsed.mainWalletAddress !== mainWalletAddress) {
    throw new Error('Stored private-funding recovery state is invalid.');
  }

  if (parsed.phase !== 'complete' && hasCompletedPrivateWalletFunding(parsed)) {
    const completed: PrivateFundingRecord = {
      ...parsed,
      phase: 'complete',
      errorCode: null,
      updatedAtMs: Date.now(),
    };
    await writePrivateFundingRecord(completed);
    return completed;
  }
  return parsed;
}

export async function writePrivateFundingRecord(
  record: PrivateFundingRecord,
): Promise<void> {
  if (parseRecord(JSON.stringify(record)) === null) {
    throw new Error('Private-funding recovery state is invalid.');
  }
  await SecureStore.setItemAsync(
    await storageKey(OPERATION_PREFIX, record.mainWalletAddress),
    JSON.stringify(record),
  );
}

function parseRecord(value: string): PrivateFundingRecord | null {
  try {
    const record = JSON.parse(value) as Record<string, unknown>;
    if (!validCommonFields(record)) return null;

    const destination = record.version === 1 ? 'private' : record.destination;
    if (destination !== 'private' && destination !== 'pacifica') return null;
    if (destination === 'pacifica' && record.symbol !== 'USDC') return null;

    const parsed: PrivateFundingRecord = {
      version: 2,
      id: record.id as string,
      mainWalletAddress: record.mainWalletAddress as string,
      tradingWalletAddress: record.tradingWalletAddress as string,
      provider: 'pacifica',
      destination,
      mint: record.mint as string,
      symbol: record.symbol as 'USDC' | 'USDT',
      amountBaseUnits: record.amountBaseUnits as string,
      phase: normalizePhase(record.phase),
      generationIndex: nullable(record.generationIndex),
      excludedNoteIds: stringArray(record.excludedNoteIds, []),
      scanStartLeafCounts: scanBoundary(record.scanStartLeafCounts),
      populateSignature: nullable(record.populateSignature),
      depositSignature: nullable(record.depositSignature),
      relayRequestId: nullable(record.relayRequestId),
      claimSignature: nullable(record.claimSignature),
      noteAmountBaseUnits: unsigned(record.noteAmountBaseUnits),
      relayerFixedFeeLamports: unsigned(record.relayerFixedFeeLamports),
      feeFundingLamports: unsigned(record.feeFundingLamports),
      feeFundingWrapSignature: nullable(record.feeFundingWrapSignature),
      feeFundingGenerationIndex: nullable(record.feeFundingGenerationIndex),
      feeFundingExcludedNoteIds: stringArray(record.feeFundingExcludedNoteIds, []),
      feeFundingScanStartLeafCounts: scanBoundary(record.feeFundingScanStartLeafCounts),
      feeFundingPopulateSignature: nullable(record.feeFundingPopulateSignature),
      feeFundingDepositSignature: nullable(record.feeFundingDepositSignature),
      feeFundingRelayRequestId: nullable(record.feeFundingRelayRequestId),
      feeFundingSignature: nullable(record.feeFundingSignature),
      feeFundingNoteAmountLamports: unsigned(record.feeFundingNoteAmountLamports),
      feeFundingRelayerFixedFeeLamports: unsigned(record.feeFundingRelayerFixedFeeLamports),
      providerDepositExpiresAtMs: nullableSafeInteger(record.providerDepositExpiresAtMs),
      providerDepositIdempotencyKey: nullable(record.providerDepositIdempotencyKey),
      providerDepositSignature: nullable(record.providerDepositSignature),
      providerDepositSignedTransactionBase64: nullable(
        record.providerDepositSignedTransactionBase64,
      ),
      errorCode: nullable(record.errorCode),
      updatedAtMs: record.updatedAtMs as number,
    };
    return validNormalizedRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function validCommonFields(record: Record<string, unknown>): boolean {
  return (record.version === 1 || record.version === 2) &&
    typeof record.id === 'string' &&
    isAddress(record.mainWalletAddress) &&
    isAddress(record.tradingWalletAddress) &&
    ['pacifica', 'flash'].includes(String(record.provider)) &&
    (record.version === 1 || record.provider === 'pacifica') &&
    isAddress(record.mint) &&
    (record.symbol === 'USDC' || record.symbol === 'USDT') &&
    typeof record.amountBaseUnits === 'string' &&
    /^\d+$/u.test(record.amountBaseUnits) &&
    isLegacyPhase(record.phase) &&
    typeof record.updatedAtMs === 'number' &&
    Number.isSafeInteger(record.updatedAtMs);
}

function validNormalizedRecord(record: PrivateFundingRecord): boolean {
  const nullableStrings = [
    record.generationIndex,
    record.populateSignature,
    record.depositSignature,
    record.relayRequestId,
    record.claimSignature,
    record.feeFundingWrapSignature,
    record.feeFundingGenerationIndex,
    record.feeFundingPopulateSignature,
    record.feeFundingDepositSignature,
    record.feeFundingRelayRequestId,
    record.feeFundingSignature,
    record.providerDepositIdempotencyKey,
    record.providerDepositSignature,
    record.providerDepositSignedTransactionBase64,
    record.errorCode,
  ];
  const unsignedValues = [
    record.noteAmountBaseUnits,
    record.relayerFixedFeeLamports,
    record.feeFundingLamports,
    record.feeFundingNoteAmountLamports,
    record.feeFundingRelayerFixedFeeLamports,
  ];
  const providerCheckpoint = [
    record.providerDepositExpiresAtMs,
    record.providerDepositIdempotencyKey,
    record.providerDepositSignature,
    record.providerDepositSignedTransactionBase64,
  ];
  const providerCheckpointValid = record.destination === 'private' ||
    providerCheckpoint.every((value) => value === null) ||
    providerCheckpoint.every((value) => value !== null);
  return nullableStrings.every((entry) => entry === null || typeof entry === 'string') &&
    unsignedValues.every((entry) => entry === null || /^\d+$/u.test(entry)) &&
    nullableScanBoundary(record.scanStartLeafCounts) &&
    nullableScanBoundary(record.feeFundingScanStartLeafCounts) &&
    Number.isSafeInteger(record.updatedAtMs) &&
    (record.providerDepositExpiresAtMs === null ||
      Number.isSafeInteger(record.providerDepositExpiresAtMs)) &&
    providerCheckpointValid &&
    (record.destination === 'private' || record.phase !== 'complete' ||
      record.providerDepositSignature !== null);
}

async function storageKey(prefix: string, address: string): Promise<string> {
  const digest = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    address,
  );
  return `${prefix}${digest}`;
}

function isAddress(value: unknown): value is string {
  try {
    return typeof value === 'string' && base58.decode(value).length === 32;
  } catch {
    return false;
  }
}

function nullable(value: unknown): string | null {
  return value === null || value === undefined
    ? null
    : typeof value === 'string'
      ? value
      : invalidValue();
}

function unsigned(value: unknown): string | null {
  const parsed = nullable(value);
  if (parsed !== null && !/^\d+$/u.test(parsed)) invalidValue();
  return parsed;
}

function nullableSafeInteger(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    invalidValue();
  }
  return value;
}

function stringArray(value: unknown, fallback: readonly string[]): readonly string[] {
  if (value === undefined) return fallback;
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    invalidValue();
  }
  return value as readonly string[];
}

function scanBoundary(value: unknown): readonly string[] | null {
  if (value === undefined || value === null) return null;
  if (!nullableScanBoundary(value)) invalidValue();
  return value;
}

function nullableScanBoundary(value: unknown): value is readonly string[] | null {
  return value === null || (
    Array.isArray(value) &&
    value.every((entry) => typeof entry === 'string' && /^\d+:\d+$/u.test(entry))
  );
}

function normalizePhase(value: unknown): PrivateFundingPhase {
  if (value === 'collateral-converting' || value === 'provider-setup') {
    return 'provider-depositing';
  }
  return value as PrivateFundingPhase;
}

function isLegacyPhase(value: unknown): boolean {
  return [
    'depositing',
    'scanning',
    'proving',
    'relaying',
    'fee-funding',
    'collateral-converting',
    'provider-setup',
    'provider-depositing',
    'complete',
  ].includes(String(value));
}

function invalidValue(): never {
  throw new Error('invalid private-funding record');
}
