import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

import type { PerpsProviderId } from '@/config/appConfig';

const PREFIX = 'perpal.trade-action.v1.';

export type PendingTradeAction = {
  readonly amountBaseUnits: string;
  readonly expiresAtMs: number;
  readonly idempotencyKey: string;
  readonly kind: 'conversion' | 'setup' | 'collateral';
  readonly owner: string;
  readonly provider: PerpsProviderId;
  readonly signature: string;
  readonly signedTransactionBase64: string | null;
  readonly updatedAtMs: number;
  readonly version: 1;
};

export async function readPendingTradeAction(
  owner: string,
  provider: PerpsProviderId,
): Promise<PendingTradeAction | null> {
  const value = await SecureStore.getItemAsync(await key(owner, provider));
  if (value === null) return null;

  try {
    const record = JSON.parse(value) as unknown;
    if (!valid(record, owner, provider)) throw new Error('invalid record');
    return record;
  } catch {
    throw new Error('Stored trade preparation state is invalid.');
  }
}

export async function writePendingTradeAction(
  record: PendingTradeAction,
): Promise<void> {
  if (!valid(record, record.owner, record.provider)) {
    throw new Error('Trade preparation state is invalid.');
  }
  await SecureStore.setItemAsync(
    await key(record.owner, record.provider),
    JSON.stringify(record),
  );
  console.info('[Perpal recovery]', JSON.stringify({
    event: 'checkpoint',
    operation: 'trade_preparation',
    phase: `${record.provider}_${record.kind}_signed`,
  }));
}

export async function removePendingTradeAction(
  owner: string,
  provider: PerpsProviderId,
): Promise<void> {
  await SecureStore.deleteItemAsync(await key(owner, provider));
}

async function key(owner: string, provider: PerpsProviderId): Promise<string> {
  const digest = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    `${owner}:${provider}`,
  );
  return `${PREFIX}${digest}`;
}

function valid(
  value: unknown,
  owner: string,
  provider: PerpsProviderId,
): value is PendingTradeAction {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return record.version === 1 && record.owner === owner &&
    record.provider === provider &&
    ['conversion', 'setup', 'collateral'].includes(String(record.kind)) &&
    typeof record.amountBaseUnits === 'string' &&
    /^\d+$/u.test(record.amountBaseUnits) &&
    typeof record.signature === 'string' && record.signature.length > 0 &&
    typeof record.idempotencyKey === 'string' && record.idempotencyKey.length > 0 &&
    (record.signedTransactionBase64 === null ||
      typeof record.signedTransactionBase64 === 'string') &&
    Number.isSafeInteger(record.expiresAtMs) &&
    Number.isSafeInteger(record.updatedAtMs);
}
