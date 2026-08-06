import { base58, base64 } from '@scure/base';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

import type { PerpsProviderId } from '@/config/appConfig';

const MASTER_SEED_PREFIX = 'perpal.umbra.master-seed.v1.';
const OPERATION_PREFIX = 'perpal.umbra.private-funding.v1.';

export type PrivateFundingPhase =
  | 'depositing'
  | 'scanning'
  | 'proving'
  | 'relaying'
  | 'fee-funding'
  | 'provider-setup'
  | 'provider-depositing'
  | 'complete';

export type PrivateFundingRecord = {
  readonly version: 1;
  readonly id: string;
  readonly mainWalletAddress: string;
  readonly tradingWalletAddress: string;
  readonly provider: PerpsProviderId;
  readonly mint: string;
  readonly symbol: 'USDC' | 'USDT';
  readonly amountBaseUnits: string;
  readonly phase: PrivateFundingPhase;
  readonly generationIndex: string | null;
  readonly excludedNoteIds: readonly string[];
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
  readonly feeFundingPopulateSignature: string | null;
  readonly feeFundingDepositSignature: string | null;
  readonly feeFundingRelayRequestId: string | null;
  readonly feeFundingSignature: string | null;
  readonly feeFundingNoteAmountLamports: string | null;
  readonly feeFundingRelayerFixedFeeLamports: string | null;
  readonly providerSetupComplete: boolean;
  readonly providerSetupSignature: string | null;
  readonly providerDepositSignature: string | null;
  readonly errorCode: string | null;
  readonly updatedAtMs: number;
};

export async function readUmbraMasterSeed(
  mainWalletAddress: string,
): Promise<Uint8Array | null> {
  const encoded = await SecureStore.getItemAsync(
    await storageKey(MASTER_SEED_PREFIX, mainWalletAddress),
  );

  if (encoded === null) {
    return null;
  }

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

  if (value === null) {
    return null;
  }

  const parsed = parseRecord(value);

  if (parsed === null || parsed.mainWalletAddress !== mainWalletAddress) {
    throw new Error('Stored private-funding recovery state is invalid.');
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
    const phase = record.phase;
    const noteAmountBaseUnits = record.noteAmountBaseUnits ?? null;
    const relayerFixedFeeLamports = record.relayerFixedFeeLamports ?? null;
    const feeFundingLamports = record.feeFundingLamports ?? null;
    const feeFundingWrapSignature = record.feeFundingWrapSignature ?? null;
    const feeFundingGenerationIndex = record.feeFundingGenerationIndex ?? null;
    const feeFundingExcludedNoteIds = record.feeFundingExcludedNoteIds ?? [];
    const feeFundingPopulateSignature = record.feeFundingPopulateSignature ?? null;
    const feeFundingDepositSignature = record.feeFundingDepositSignature ?? null;
    const feeFundingRelayRequestId = record.feeFundingRelayRequestId ?? null;
    const feeFundingSignature = record.feeFundingSignature ?? null;
    const feeFundingNoteAmountLamports = record.feeFundingNoteAmountLamports ?? null;
    const feeFundingRelayerFixedFeeLamports =
      record.feeFundingRelayerFixedFeeLamports ?? null;
    const providerSetupComplete = record.providerSetupComplete ?? false;
    const providerSetupSignature = record.providerSetupSignature ?? null;
    const providerDepositSignature = record.providerDepositSignature ?? null;

    if (
      record.version !== 1 ||
      typeof record.id !== 'string' ||
      !isAddress(record.mainWalletAddress) ||
      !isAddress(record.tradingWalletAddress) ||
      (record.provider !== 'flash' && record.provider !== 'velocity') ||
      !isAddress(record.mint) ||
      (record.symbol !== 'USDC' && record.symbol !== 'USDT') ||
      typeof record.amountBaseUnits !== 'string' ||
      !/^\d+$/u.test(record.amountBaseUnits) ||
      !isPhase(phase) ||
      !nullableString(record.generationIndex) ||
      !Array.isArray(record.excludedNoteIds) ||
      !record.excludedNoteIds.every((entry) => typeof entry === 'string') ||
      !nullableString(record.populateSignature) ||
      !nullableString(record.depositSignature) ||
      !nullableString(record.relayRequestId) ||
      !nullableString(record.claimSignature) ||
      !nullableUnsignedInteger(noteAmountBaseUnits) ||
      !nullableUnsignedInteger(relayerFixedFeeLamports) ||
      !nullableUnsignedInteger(feeFundingLamports) ||
      !nullableString(feeFundingWrapSignature) ||
      !nullableString(feeFundingGenerationIndex) ||
      !Array.isArray(feeFundingExcludedNoteIds) ||
      !feeFundingExcludedNoteIds.every((entry) => typeof entry === 'string') ||
      !nullableString(feeFundingPopulateSignature) ||
      !nullableString(feeFundingDepositSignature) ||
      !nullableString(feeFundingRelayRequestId) ||
      !nullableString(feeFundingSignature) ||
      !nullableUnsignedInteger(feeFundingNoteAmountLamports) ||
      !nullableUnsignedInteger(feeFundingRelayerFixedFeeLamports) ||
      typeof providerSetupComplete !== 'boolean' ||
      !nullableString(providerSetupSignature) ||
      !nullableString(providerDepositSignature) ||
      !nullableString(record.errorCode) ||
      typeof record.updatedAtMs !== 'number' ||
      !Number.isSafeInteger(record.updatedAtMs)
    ) {
      return null;
    }

    return {
      ...record,
      noteAmountBaseUnits,
      relayerFixedFeeLamports,
      feeFundingLamports,
      feeFundingWrapSignature,
      feeFundingGenerationIndex,
      feeFundingExcludedNoteIds,
      feeFundingPopulateSignature,
      feeFundingDepositSignature,
      feeFundingRelayRequestId,
      feeFundingSignature,
      feeFundingNoteAmountLamports,
      feeFundingRelayerFixedFeeLamports,
      providerSetupComplete,
      providerSetupSignature,
      providerDepositSignature,
    } as unknown as PrivateFundingRecord;
  } catch {
    return null;
  }
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

function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function nullableUnsignedInteger(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && /^\d+$/u.test(value));
}

function isPhase(value: unknown): value is PrivateFundingPhase {
  return (
    value === 'depositing' ||
    value === 'scanning' ||
    value === 'proving' ||
    value === 'relaying' ||
    value === 'fee-funding' ||
    value === 'provider-setup' ||
    value === 'provider-depositing' ||
    value === 'complete'
  );
}
