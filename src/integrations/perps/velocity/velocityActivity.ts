import { Connection, PublicKey } from '@solana/web3.js';
import { isVariant } from '@velocity-exchange/sdk/lib/browser/types';
import type { VelocityClient } from '@velocity-exchange/sdk/lib/browser/velocityClient';
import {
  fetchLogs,
  LogParser,
} from '@velocity-exchange/sdk/lib/browser/events/fetchLogs';
import type {
  EventMap,
  EventType,
  WrappedEvent,
} from '@velocity-exchange/sdk/lib/browser/events/types';

import type { GatewayRequestSigner } from '@/integrations/api/gatewayClient';
import { createGatewayRequestHeaders } from '@/integrations/api/gatewayClient';
import { parseGatewayRpcOperation } from '@/integrations/api/gatewayProtocol';
import { velocityMarketSymbol } from '@/integrations/perps/velocity/velocityAccount';

export type VelocityTradeActivity = {
  readonly amountBaseUnits: bigint;
  readonly createdAtMs: number;
  readonly effect: 'closed' | 'increased' | 'opened' | 'reduced' | 'reversed';
  readonly feeBaseUnits: bigint;
  readonly id: string;
  readonly priceBaseUnits: bigint;
  readonly quoteBaseUnits: bigint;
  readonly role: 'maker' | 'taker';
  readonly side: 'long' | 'short';
  readonly symbol: string;
};

export type VelocityTradeHistory = {
  readonly latestTx: string | null;
  readonly trades: readonly VelocityTradeActivity[];
  readonly truncated: boolean;
};

const HISTORY_PAGE_SIZE = 100;
const HISTORY_BATCH_SIZE = 10;
const MAX_HISTORY_PAGES = 10;
const MAX_HISTORY_ITEMS = HISTORY_PAGE_SIZE * MAX_HISTORY_PAGES;

/** Reads confirmed Velocity fills touching this exact user account PDA. */
export async function fetchVelocityTradeHistory(input: {
  readonly client: VelocityClient;
  readonly rpcUrl: string;
  readonly signal: AbortSignal;
  readonly signer: GatewayRequestSigner;
  readonly untilTx?: string;
  readonly userPda: PublicKey;
}): Promise<VelocityTradeHistory> {
  const connection = new Connection(input.rpcUrl, {
    commitment: 'confirmed',
    fetch: signedRpcFetch(input.signer, input.signal),
  });
  const parser = new LogParser(input.client.program);
  const trades: VelocityTradeActivity[] = [];
  let before: string | undefined;
  let pageCount = 0;
  let exhausted = false;
  let latestTx: string | null = null;

  while (!input.signal.aborted && pageCount < MAX_HISTORY_PAGES) {
    const page = await fetchLogs(
      connection,
      input.userPda,
      'confirmed',
      before,
      input.untilTx,
      HISTORY_PAGE_SIZE,
      HISTORY_BATCH_SIZE,
    );
    pageCount += 1;

    if (page === undefined) {
      exhausted = true;
      break;
    }
    latestTx ??= page.mostRecentTx;

    for (const log of page.transactionLogs) {
      trades.push(...parseVelocityTradeEvents(parser.parseEventsFromLogs(log), input.userPda));
    }

    if (page.earliestTx === before) {
      exhausted = true;
      break;
    }
    before = page.earliestTx;
  }

  if (input.signal.aborted) throw abortError();

  return {
    latestTx,
    trades: trades
      .sort((left, right) => right.createdAtMs - left.createdAtMs)
      .slice(0, MAX_HISTORY_ITEMS),
    truncated: !exhausted,
  };
}

export function mergeVelocityTradeHistory(
  previous: VelocityTradeHistory,
  latest: VelocityTradeHistory,
): VelocityTradeHistory {
  const trades = new Map(previous.trades.map((trade) => [trade.id, trade]));
  for (const trade of latest.trades) trades.set(trade.id, trade);
  const merged = [...trades.values()]
    .sort((left, right) => right.createdAtMs - left.createdAtMs)
    .slice(0, MAX_HISTORY_ITEMS);

  return {
    latestTx: latest.latestTx ?? previous.latestTx,
    trades: merged,
    truncated: previous.truncated || latest.truncated || trades.size > merged.length,
  };
}

export function parseVelocityTradeEvents(
  events: readonly WrappedEvent<EventType>[],
  userPda: PublicKey,
): readonly VelocityTradeActivity[] {
  return events.flatMap((wrapped) => {
    if (wrapped.eventType !== 'OrderActionRecord') return [];
    const event = wrapped as EventMap['OrderActionRecord'] & {
      readonly eventType: 'OrderActionRecord';
    };
    if (!isVariant(event.action, 'fill') || !isVariant(event.marketType, 'perp')) return [];

    const role = event.taker?.equals(userPda)
      ? 'taker'
      : event.maker?.equals(userPda)
        ? 'maker'
        : null;
    const direction = role === 'taker' ? event.takerOrderDirection : event.makerOrderDirection;
    const existing = role === 'taker'
      ? event.takerExistingBaseAssetAmount
      : event.makerExistingBaseAssetAmount;
    if (
      role === null ||
      direction === null ||
      existing === null ||
      event.baseAssetAmountFilled === null ||
      event.quoteAssetAmountFilled === null
    ) return [];

    const amountBaseUnits = BigInt(event.baseAssetAmountFilled.toString());
    const quoteBaseUnits = BigInt(event.quoteAssetAmountFilled.toString());
    if (amountBaseUnits <= 0n || quoteBaseUnits < 0n) return [];
    const orderSide = isVariant(direction, 'long') ? 'long' : 'short';
    const existingBaseUnits = BigInt(existing.toString());
    const nextBaseUnits = existingBaseUnits + (
      orderSide === 'long' ? amountBaseUnits : -amountBaseUnits
    );
    const effect = fillEffect(existingBaseUnits, nextBaseUnits);
    const side = effect === 'closed' || effect === 'reduced'
      ? (existingBaseUnits > 0n ? 'long' : 'short')
      : (nextBaseUnits > 0n ? 'long' : 'short');
    const timestampSeconds = Number(event.ts.toString());
    if (!Number.isSafeInteger(timestampSeconds) || timestampSeconds <= 0) return [];
    const fee = role === 'taker' ? event.takerFee : event.makerFee;

    return [{
      amountBaseUnits,
      createdAtMs: timestampSeconds * 1_000,
      effect,
      feeBaseUnits: fee === null ? 0n : BigInt(fee.toString()),
      id: `velocity:${event.txSig}:${event.txSigIndex}`,
      priceBaseUnits: (quoteBaseUnits * 1_000_000_000n) / amountBaseUnits,
      quoteBaseUnits,
      role,
      side,
      symbol: velocityMarketSymbol(event.marketIndex),
    }];
  });
}

function fillEffect(
  before: bigint,
  after: bigint,
): VelocityTradeActivity['effect'] {
  if (before === 0n) return 'opened';
  if (after === 0n) return 'closed';
  if ((before > 0n) !== (after > 0n)) return 'reversed';
  return absolute(after) > absolute(before) ? 'increased' : 'reduced';
}

function absolute(value: bigint): bigint {
  return value < 0n ? -value : value;
}

function signedRpcFetch(
  signer: GatewayRequestSigner,
  signal: AbortSignal,
): typeof fetch {
  return async (resource, init) => {
    if (signal.aborted) throw abortError();
    const body = typeof init?.body === 'string' ? init.body : null;
    const operation = body === null ? null : parseGatewayRpcOperation(body);
    if (body === null || operation === null) {
      throw new Error('Velocity history RPC request is invalid.');
    }
    const signed = await createGatewayRequestHeaders({
      body,
      cluster: 'mainnet',
      operation,
      signer,
    });
    const headers = new Headers(init?.headers);
    for (const [name, value] of Object.entries(signed)) headers.set(name, value);
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener('abort', abort, { once: true });
    init?.signal?.addEventListener('abort', abort, { once: true });

    try {
      return await fetch(resource, { ...init, body, headers, signal: controller.signal });
    } finally {
      signal.removeEventListener('abort', abort);
      init?.signal?.removeEventListener('abort', abort);
    }
  };
}

function abortError(): Error {
  const error = new Error('Velocity history request was cancelled.');
  error.name = 'AbortError';
  return error;
}
