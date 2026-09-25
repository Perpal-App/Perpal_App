import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

import type { PerpsProviderId } from '@/config/appConfig';

const PREFIX = 'perpal.trade-action.v1.';

export type TradeActionScope = PerpsProviderId | 'wallet' | 'wallet-withdrawal';

export type PendingTradeAction = {
  readonly amountBaseUnits: string;
  readonly expiresAtMs: number;
  readonly idempotencyKey: string;
  /**
   * `setup` is a migration reader and nothing writes it any more — it belonged to the removed Velocity
   * provider-setup step. It stays in the union and in `valid` below on purpose: a device that abandoned
   * that step still has such a record, and dropping the label would make `readPendingTradeAction` throw
   * "Stored trade preparation state is invalid." on a record that can otherwise be read and cleared.
   *
   * `conversion` is live, despite reading like residue of the same era — `walletStablecoinSwap` writes
   * it and `tradeActionRecovery` treats it as one of the two versioned kinds.
   */
  readonly kind: 'conversion' | 'setup' | 'collateral' | 'fast-collateral' | 'trade' | 'close' | 'withdraw';
  /**
   * Pacifica balance immediately before a collateral deposit and the expected exact increase.
   * Present only for collateral records that remain locked through Pacifica's indexing phase.
   */
  readonly providerBalanceBeforeBaseUnits?: string | null;
  readonly expectedProviderCreditBaseUnits?: string | null;
  readonly owner: string;
  readonly provider: TradeActionScope;
  readonly signature: string;
  readonly signedTransactionBase64: string | null;
  readonly updatedAtMs: number;
  readonly version: 1;
};

export async function readPendingTradeAction(
  owner: string,
  provider: TradeActionScope,
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
  provider: TradeActionScope,
): Promise<void> {
  await SecureStore.deleteItemAsync(await key(owner, provider));
}

async function key(owner: string, provider: TradeActionScope): Promise<string> {
  const digest = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    `${owner}:${provider}`,
  );
  return `${PREFIX}${digest}`;
}

function valid(
  value: unknown,
  owner: string,
  provider: TradeActionScope,
): value is PendingTradeAction {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return record.version === 1 && record.owner === owner &&
    record.provider === provider &&
    ['conversion', 'setup', 'collateral', 'fast-collateral', 'trade', 'close', 'withdraw'].includes(String(record.kind)) &&
    optionalInteger(record.providerBalanceBeforeBaseUnits) &&
    optionalUnsigned(record.expectedProviderCreditBaseUnits) &&
    typeof record.amountBaseUnits === 'string' &&
    /^\d+$/u.test(record.amountBaseUnits) &&
    typeof record.signature === 'string' && record.signature.length > 0 &&
    typeof record.idempotencyKey === 'string' && record.idempotencyKey.length > 0 &&
    (record.signedTransactionBase64 === null ||
      typeof record.signedTransactionBase64 === 'string') &&
    Number.isSafeInteger(record.expiresAtMs) &&
    Number.isSafeInteger(record.updatedAtMs);
}

function optionalInteger(value: unknown): boolean {
  return value === undefined || value === null || (
    typeof value === 'string' && /^-?\d+$/u.test(value)
  );
}

function optionalUnsigned(value: unknown): boolean {
  return value === undefined || value === null || (
    typeof value === 'string' && /^\d+$/u.test(value)
  );
}
