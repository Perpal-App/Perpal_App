import { createMMKV, type MMKV } from 'react-native-mmkv';

import { privateIdentifier } from '@/storage/privateIdentifier';

export type PacificaLifecycleCheckpoint = {
  readonly balanceKeys: readonly string[];
  readonly tradeKeys: readonly string[];
  readonly updatedAtMs: number;
  readonly version: 1;
};

const KEY_PREFIX = 'account-lifecycle.v1.';
const MAX_KEYS_PER_FEED = 512;
let storage: MMKV | null = null;

export function pacificaLifecycleScope(input: {
  readonly account: string;
  readonly network: 'mainnet';
  readonly ownerAddress: string;
}): string {
  return privateIdentifier(
    'pacifica-lifecycle-scope',
    `${input.network}:${input.ownerAddress}:${input.account}`,
  );
}

export function readPacificaLifecycleCheckpoint(
  scope: string,
): PacificaLifecycleCheckpoint | null {
  try {
    const value = getStorage().getString(`${KEY_PREFIX}${scope}`);
    if (value === undefined) return null;
    const parsed = JSON.parse(value) as unknown;
    return valid(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function writePacificaLifecycleCheckpoint(
  scope: string,
  checkpoint: PacificaLifecycleCheckpoint,
): void {
  const bounded: PacificaLifecycleCheckpoint = {
    ...checkpoint,
    balanceKeys: checkpoint.balanceKeys.slice(0, MAX_KEYS_PER_FEED),
    tradeKeys: checkpoint.tradeKeys.slice(0, MAX_KEYS_PER_FEED),
  };
  try {
    getStorage().set(`${KEY_PREFIX}${scope}`, JSON.stringify(bounded));
  } catch {
    // The in-memory monitor remains correct for this session. A later successful poll retries.
  }
}

export function pacificaLifecycleEventKey(
  feed: 'balance' | 'trade',
  sourceIdentifier: string,
): string {
  return privateIdentifier(`pacifica-${feed}-event`, sourceIdentifier);
}

function getStorage(): MMKV {
  storage ??= createMMKV({
    id: 'perpal.pacifica-lifecycle.v1',
    compareBeforeSet: true,
    recoveryStrategy: 'discard-on-error',
  });
  return storage;
}

function valid(value: unknown): value is PacificaLifecycleCheckpoint {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return item.version === 1 && Number.isSafeInteger(item.updatedAtMs) &&
    (item.updatedAtMs as number) > 0 &&
    validKeys(item.balanceKeys) && validKeys(item.tradeKeys);
}

function validKeys(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.length <= MAX_KEYS_PER_FEED &&
    value.every((key) => typeof key === 'string' && /^[0-9a-f]{64}$/u.test(key));
}
