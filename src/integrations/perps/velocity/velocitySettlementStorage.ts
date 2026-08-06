import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

import type { PublicMarketSymbol } from '@/integrations/perps/markets/publicMarketData';

const PREFIX = 'perpal.velocity.settlement.v1.';

export type PendingVelocitySettlement = {
  readonly closeSignature: string;
  readonly errorCode: string | null;
  readonly marketIndex: number;
  readonly owner: string;
  readonly settlementSignature: string | null;
  readonly symbol: PublicMarketSymbol;
  readonly updatedAtMs: number;
};

export async function readPendingVelocitySettlements(
  owner: string,
): Promise<readonly PendingVelocitySettlement[]> {
  const value = await SecureStore.getItemAsync(await key(owner));
  if (value === null) return [];

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) throw new Error('invalid settlement list');
    const records = parsed.filter(isRecord);
    if (records.length !== parsed.length || records.some((record) => record.owner !== owner)) {
      throw new Error('invalid settlement record');
    }
    return records;
  } catch {
    throw new Error('Stored Velocity settlement state is invalid.');
  }
}

export async function writePendingVelocitySettlement(
  record: PendingVelocitySettlement,
): Promise<void> {
  const records = await readPendingVelocitySettlements(record.owner);
  const next = [
    ...records.filter((candidate) => candidate.marketIndex !== record.marketIndex),
    record,
  ];
  await SecureStore.setItemAsync(await key(record.owner), JSON.stringify(next));
  logCheckpoint(record.settlementSignature === null
    ? 'close_submitted'
    : 'withdrawal_submitted');
}

export async function removePendingVelocitySettlement(
  owner: string,
  marketIndex: number,
): Promise<void> {
  const records = await readPendingVelocitySettlements(owner);
  await SecureStore.setItemAsync(
    await key(owner),
    JSON.stringify(records.filter((record) => record.marketIndex !== marketIndex)),
  );
  logCheckpoint('complete');
}

function logCheckpoint(phase: string): void {
  console.info('[Perpal recovery]', JSON.stringify({
    event: 'checkpoint',
    operation: 'velocity_settlement',
    phase,
  }));
}

async function key(owner: string): Promise<string> {
  return `${PREFIX}${await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    owner,
  )}`;
}

function isRecord(value: unknown): value is PendingVelocitySettlement {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return typeof record.closeSignature === 'string' &&
    (record.errorCode === null || typeof record.errorCode === 'string') &&
    Number.isInteger(record.marketIndex) &&
    typeof record.owner === 'string' &&
    (record.settlementSignature === null || typeof record.settlementSignature === 'string') &&
    ['BTC-PERP', 'ETH-PERP', 'SOL-PERP'].includes(String(record.symbol)) &&
    Number.isSafeInteger(record.updatedAtMs);
}
