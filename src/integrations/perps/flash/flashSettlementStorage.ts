import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

import type { FlashOrderSide } from '@/integrations/perps/flash/flashMarketOrder';
import type { PublicMarketSymbol } from '@/integrations/perps/markets/publicMarketData';

const PREFIX = 'perpal.flash.settlement.v1.';

export type PendingFlashSettlement = {
  readonly amountBaseUnits: string;
  readonly closeSignature: string;
  readonly errorCode: string | null;
  readonly feeFundingSignature: string | null;
  readonly owner: string;
  readonly side: FlashOrderSide;
  readonly symbol: PublicMarketSymbol;
  readonly updatedAtMs: number;
  readonly walletBalanceBefore: string | null;
  readonly withdrawalSignature: string | null;
};

export async function readPendingFlashSettlements(
  owner: string,
): Promise<readonly PendingFlashSettlement[]> {
  const value = await SecureStore.getItemAsync(await key(owner));
  if (value === null) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed) || !parsed.every((record) => valid(record, owner))) {
      throw new Error('invalid Flash settlement records');
    }
    return parsed;
  } catch {
    throw new Error('Stored Flash settlement state is invalid.');
  }
}

export async function queueFlashSettlement(record: Omit<
  PendingFlashSettlement,
  'errorCode' | 'updatedAtMs' | 'withdrawalSignature'
  | 'feeFundingSignature'
  | 'walletBalanceBefore'
>): Promise<void> {
  const records = await readPendingFlashSettlements(record.owner);
  await write(record.owner, [
    ...records.filter((candidate) =>
      candidate.symbol !== record.symbol || candidate.side !== record.side,
    ),
    {
      ...record,
      errorCode: null,
      feeFundingSignature: null,
      updatedAtMs: Date.now(),
      walletBalanceBefore: null,
      withdrawalSignature: null,
    },
  ]);
  logCheckpoint('close_submitted');
}

export async function writePendingFlashSettlement(
  record: PendingFlashSettlement,
): Promise<void> {
  const records = await readPendingFlashSettlements(record.owner);
  await write(record.owner, [
    ...records.filter((candidate) =>
      candidate.symbol !== record.symbol || candidate.side !== record.side,
    ),
    record,
  ]);
  logCheckpoint(record.withdrawalSignature !== null
    ? 'withdrawal_submitted'
    : record.feeFundingSignature !== null
      ? 'fee_funding_submitted'
      : 'close_submitted');
}

export async function removePendingFlashSettlement(
  owner: string,
  symbol: PublicMarketSymbol,
  side: FlashOrderSide,
): Promise<void> {
  const records = await readPendingFlashSettlements(owner);
  await write(owner, records.filter((record) =>
    record.symbol !== symbol || record.side !== side,
  ));
  logCheckpoint('complete');
}

function logCheckpoint(phase: string): void {
  console.info('[Perpal recovery]', JSON.stringify({
    event: 'checkpoint',
    operation: 'flash_settlement',
    phase,
  }));
}

async function write(owner: string, records: readonly PendingFlashSettlement[]) {
  await SecureStore.setItemAsync(await key(owner), JSON.stringify(records));
}

async function key(owner: string): Promise<string> {
  return `${PREFIX}${await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, owner)}`;
}

function valid(value: unknown, owner: string): value is PendingFlashSettlement {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return record.owner === owner && typeof record.closeSignature === 'string' &&
    typeof record.amountBaseUnits === 'string' && /^\d+$/u.test(record.amountBaseUnits) &&
    (record.errorCode === null || typeof record.errorCode === 'string') &&
    (record.feeFundingSignature === null || typeof record.feeFundingSignature === 'string') &&
    (record.side === 'long' || record.side === 'short') &&
    ['BTC-PERP', 'ETH-PERP', 'SOL-PERP'].includes(String(record.symbol)) &&
    Number.isSafeInteger(record.updatedAtMs) &&
    (record.walletBalanceBefore === null ||
      (typeof record.walletBalanceBefore === 'string' && /^\d+$/u.test(record.walletBalanceBefore))) &&
    (record.withdrawalSignature === null || typeof record.withdrawalSignature === 'string');
}
