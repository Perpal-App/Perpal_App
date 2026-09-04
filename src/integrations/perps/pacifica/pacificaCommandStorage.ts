import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

import type { PacificaOperation } from '@/integrations/perps/pacifica/pacificaApi';

const PREFIX = 'perpal.pacifica-command.v1.';
const MAX_ENCODED_BYTES = 12_000;

type CreateOperation = Extract<
  PacificaOperation,
  'create_market_order' | 'create_order' | 'create_stop_order'
>;

export type PacificaCreateCommandStage =
  | 'margin_pending'
  | 'leverage_pending'
  | 'order_pending'
  | 'acknowledged';

export type PacificaCreateCommand = {
  readonly action: 'open' | 'close';
  readonly attemptedAtMs: number;
  readonly clientOrderId: string;
  readonly kind: 'create';
  readonly leverage: number;
  readonly marginMode: 'isolated' | 'cross';
  readonly maxLeverage: number;
  readonly operation: CreateOperation;
  readonly orderId: number | null;
  readonly orderPayload: Readonly<Record<string, unknown>>;
  readonly owner: string;
  readonly reviewExpiresAtMs: number;
  readonly stage: PacificaCreateCommandStage;
  readonly symbol: string;
  readonly traceId: string;
  readonly updatedAtMs: number;
  readonly version: 1;
};

export type PacificaCancelCommand = {
  readonly attemptedAtMs: number;
  readonly clientOrderId: string | null;
  readonly kind: 'cancel';
  readonly orderId: number;
  readonly owner: string;
  readonly stage: 'cancel_pending';
  readonly symbol: string;
  readonly traceId: string;
  readonly updatedAtMs: number;
  readonly version: 1;
};

export type PendingPacificaCommand = PacificaCreateCommand | PacificaCancelCommand;

export async function readPendingPacificaCommand(
  owner: string,
): Promise<PendingPacificaCommand | null> {
  const encoded = await SecureStore.getItemAsync(await storageKey(owner));
  if (encoded === null) return null;
  try {
    const value = JSON.parse(encoded) as unknown;
    if (!validCommand(value, owner)) throw new Error('invalid record');
    return value;
  } catch {
    throw new Error('Stored Pacifica order recovery state is invalid.');
  }
}

export async function writePendingPacificaCommand(
  command: PendingPacificaCommand,
): Promise<void> {
  if (!validCommand(command, command.owner)) {
    throw new Error('Pacifica order recovery state is invalid.');
  }
  const encoded = JSON.stringify(command);
  if (new TextEncoder().encode(encoded).byteLength > MAX_ENCODED_BYTES) {
    throw new Error('Pacifica order recovery state is too large.');
  }
  await SecureStore.setItemAsync(await storageKey(command.owner), encoded);
  console.info('[Perpal recovery]', JSON.stringify({
    event: 'checkpoint',
    operation: `pacifica_${command.kind}`,
    phase: command.stage,
    traceId: command.traceId,
  }));
}

export async function removePendingPacificaCommand(owner: string): Promise<void> {
  await SecureStore.deleteItemAsync(await storageKey(owner));
}

async function storageKey(owner: string): Promise<string> {
  const digest = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    owner,
  );
  return `${PREFIX}${digest}`;
}

function validCommand(value: unknown, owner: string): value is PendingPacificaCommand {
  if (!record(value)) return false;
  if (
    value.version !== 1 || value.owner !== owner ||
    !boundedText(value.owner, 128) || !boundedText(value.symbol, 32) ||
    !uuid(value.traceId) || !positiveTimestamp(value.attemptedAtMs) ||
    !positiveTimestamp(value.updatedAtMs)
  ) return false;

  if (value.kind === 'cancel') {
    return value.stage === 'cancel_pending' && positiveInteger(value.orderId) &&
      (value.clientOrderId === null || uuid(value.clientOrderId));
  }
  if (value.kind !== 'create') return false;
  if (
    !['margin_pending', 'leverage_pending', 'order_pending', 'acknowledged'].includes(String(value.stage)) ||
    !['open', 'close'].includes(String(value.action)) ||
    !['isolated', 'cross'].includes(String(value.marginMode)) ||
    !['create_market_order', 'create_order', 'create_stop_order'].includes(String(value.operation)) ||
    !uuid(value.clientOrderId) || !positiveInteger(value.leverage) ||
    !positiveInteger(value.maxLeverage) || value.leverage > value.maxLeverage ||
    !positiveTimestamp(value.reviewExpiresAtMs) || !record(value.orderPayload) ||
    (value.stage === 'acknowledged' ? !positiveInteger(value.orderId) : value.orderId !== null) ||
    !jsonValue(value.orderPayload, 0)
  ) return false;
  return orderClientId(value.orderPayload) === value.clientOrderId;
}

function orderClientId(payload: Record<string, unknown>): string | null {
  if (typeof payload.client_order_id === 'string') return payload.client_order_id;
  return record(payload.stop_order) && typeof payload.stop_order.client_order_id === 'string'
    ? payload.stop_order.client_order_id
    : null;
}

function jsonValue(value: unknown, depth: number): boolean {
  if (depth > 4) return false;
  if (value === null || typeof value === 'boolean') return true;
  if (typeof value === 'string') return value.length <= 512;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.length <= 20 && value.every((child) => jsonValue(child, depth + 1));
  if (!record(value) || Object.keys(value).length > 24) return false;
  return Object.entries(value).every(
    ([key, child]) => key.length <= 64 && jsonValue(child, depth + 1),
  );
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function boundedText(value: unknown, maximum: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum;
}

function uuid(value: unknown): value is string {
  return typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
}

function positiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function positiveTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}
