import type { GatewayRequestSigner } from '@/integrations/api/gatewayClient';
import { MAX_GATEWAY_RPC_BATCH_ENTRIES } from '@/integrations/api/gatewayProtocol';
import {
  signedSolanaRpc,
  signedSolanaRpcBatch,
} from '@/integrations/api/signedSolanaRpc';
import {
  parseSolanaWalletAction,
  type ParsedWalletTransaction,
  type SolanaWalletAction,
} from '@/integrations/solana/solanaWalletActivityParser';
import { privateIdentifier } from '@/storage/privateIdentifier';

export type SolanaWalletActivity = {
  readonly action: SolanaWalletAction;
  readonly correlationKey: string;
  readonly createdAtMs: number;
  readonly id: string;
  readonly outcome: 'success';
};

type SignatureEntry = {
  readonly blockTime: number | null;
  readonly err: unknown;
  readonly signature: string;
};

type HistorySource = {
  readonly entries: readonly SignatureEntry[];
  readonly wallet: 'private' | 'public';
};

const HISTORY_LIMIT = 40;
const TRANSACTION_BATCH_CONCURRENCY = 2;
const TRANSACTION_CACHE_LIMIT = 256;
const TRANSACTION_CACHE_MS = 6 * 60 * 60_000;
const MISSING_TRANSACTION_CACHE_MS = 15_000;

type CachedTransaction = {
  readonly expiresAtMs: number;
  readonly value: ParsedWalletTransaction | null;
};

// Confirmed transaction details are immutable. Signature pages remain the authority for which entries
// are current; this bounded cache only prevents re-downloading and JSON-decoding the same returned IDs.
const transactionCache = new Map<string, CachedTransaction>();

export async function fetchSolanaWalletActivity(input: {
  readonly pacificaProgramId: string;
  readonly privateAddress: string;
  readonly publicAddress: string;
  readonly rpcUrl: string;
  readonly signal?: AbortSignal;
  readonly signer: GatewayRequestSigner;
  readonly usdcMint: string;
  readonly usdtMint: string;
}): Promise<readonly SolanaWalletActivity[]> {
  const addresses = uniqueAddresses(input.publicAddress, input.privateAddress);
  const results = await Promise.allSettled(addresses.map(({ address }) =>
    signedSolanaRpc<readonly SignatureEntry[]>({
      method: 'getSignaturesForAddress',
      params: [address, { commitment: 'confirmed', limit: HISTORY_LIMIT }],
      rpcUrl: input.rpcUrl,
      signer: input.signer,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    }),
  ));

  const fulfilled = results.flatMap((result, index): readonly HistorySource[] => (
    result.status === 'fulfilled'
      ? [{ entries: result.value, wallet: addresses[index]?.wallet ?? 'private' }]
      : []
  ));
  if (fulfilled.length === 0) {
    const failed = results.find((result) => result.status === 'rejected');
    throw failed?.status === 'rejected' ? failed.reason : new Error('Wallet history is unavailable.');
  }

  const bySignature = new Map<string, SignatureEntry>();
  for (const source of fulfilled) {
    for (const entry of source.entries) {
      if (validEntry(entry) && entry.err === null) bySignature.set(entry.signature, entry);
    }
  }

  const transactions = await fetchTransactions(
    [...bySignature.keys()],
    input.rpcUrl,
    input.signer,
    input.signal,
  );
  const items = [...bySignature.entries()].flatMap(([signature, entry]) => {
    const transaction = transactions.values.get(signature);
    if (transaction === undefined || transaction === null) return [];
    const action = parseSolanaWalletAction({
      pacificaProgramId: input.pacificaProgramId,
      privateAddress: input.privateAddress,
      publicAddress: input.publicAddress,
      transaction,
      usdcMint: input.usdcMint,
      usdtMint: input.usdtMint,
    });

    if (action === null) return [];

    return [{
      action,
      correlationKey: `solana-transaction:${privateIdentifier('solana-transaction', signature)}`,
      createdAtMs: (entry.blockTime as number) * 1_000,
      id: privateIdentifier('solana-wallet-activity', signature),
      outcome: 'success' as const,
    }];
  }).sort((left, right) => right.createdAtMs - left.createdAtMs);

  if (__DEV__) {
    console.info('[Perpal Solana activity]', JSON.stringify({
      decodedCount: transactions.values.size,
      detailCacheHitCount: transactions.cacheHitCount,
      detailFetchCount: transactions.fetchCount,
      detailFailureCount: transactions.failureCount,
      event: 'history_decoded',
      monetaryCount: items.length,
      signatureCount: bySignature.size,
      skippedCount: bySignature.size - items.length,
    }));
  }

  return items;
}

async function fetchTransactions(
  signatures: readonly string[],
  rpcUrl: string,
  signer: GatewayRequestSigner,
  signal?: AbortSignal,
): Promise<{
  readonly cacheHitCount: number;
  readonly failureCount: number;
  readonly fetchCount: number;
  readonly values: ReadonlyMap<string, ParsedWalletTransaction | null>;
}> {
  const values = new Map<string, ParsedWalletTransaction | null>();
  const missing: string[] = [];
  let cacheHitCount = 0;
  for (const signature of signatures) {
    const cached = readCachedTransaction(signature);
    if (cached === undefined) missing.push(signature);
    else {
      cacheHitCount += 1;
      values.set(signature, cached);
    }
  }
  const batches = chunks(missing, MAX_GATEWAY_RPC_BATCH_ENTRIES);
  let failureCount = 0;
  let nextBatch = 0;

  const worker = async () => {
    while (nextBatch < batches.length) {
      if (isAborted(signal)) throw new Error('Wallet activity request cancelled.');
      const batch = batches[nextBatch];
      nextBatch += 1;
      if (batch === undefined) return;

      try {
        const results = await signedSolanaRpcBatch<ParsedWalletTransaction | null>({
          requests: batch.map((signature) => ({
            method: 'getTransaction',
            params: [signature, {
              commitment: 'confirmed',
              encoding: 'jsonParsed',
              maxSupportedTransactionVersion: 0,
            }],
          })),
          rpcUrl,
          signer,
          ...(signal === undefined ? {} : { signal }),
        });
        results.forEach((result, index) => {
          const signature = batch[index];
          if (signature === undefined) return;
          if (result.ok) {
            values.set(signature, result.value);
            writeCachedTransaction(signature, result.value);
          } else failureCount += 1;
        });
      } catch {
        if (isAborted(signal)) throw new Error('Wallet activity request cancelled.');
        failureCount += batch.length;
      }
    }
  };

  await Promise.all(Array.from(
    { length: Math.min(TRANSACTION_BATCH_CONCURRENCY, batches.length) },
    worker,
  ));

  if (signatures.length > 0 && values.size === 0) {
    throw new Error('Wallet transaction details are unavailable.');
  }

  return {
    cacheHitCount,
    failureCount,
    fetchCount: missing.length,
    values,
  };
}

function readCachedTransaction(signature: string): ParsedWalletTransaction | null | undefined {
  const cached = transactionCache.get(signature);
  if (cached === undefined) return undefined;
  if (cached.expiresAtMs <= Date.now()) {
    transactionCache.delete(signature);
    return undefined;
  }
  // Move to the end so eviction is access-ordered rather than insertion-ordered.
  transactionCache.delete(signature);
  transactionCache.set(signature, cached);
  return cached.value;
}

function writeCachedTransaction(signature: string, value: ParsedWalletTransaction | null): void {
  transactionCache.delete(signature);
  transactionCache.set(signature, {
    expiresAtMs: Date.now() + (
      value === null ? MISSING_TRANSACTION_CACHE_MS : TRANSACTION_CACHE_MS
    ),
    value,
  });
  while (transactionCache.size > TRANSACTION_CACHE_LIMIT) {
    const oldest = transactionCache.keys().next().value as string | undefined;
    if (oldest === undefined) return;
    transactionCache.delete(oldest);
  }
}

function chunks<T>(values: readonly T[], size: number): readonly (readonly T[])[] {
  const output: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    output.push(values.slice(index, index + size));
  }
  return output;
}

function uniqueAddresses(
  publicAddress: string,
  privateAddress: string,
): readonly { readonly address: string; readonly wallet: 'private' | 'public' }[] {
  return publicAddress === privateAddress
    ? [{ address: publicAddress, wallet: 'public' }]
    : [
        { address: publicAddress, wallet: 'public' },
        { address: privateAddress, wallet: 'private' },
      ];
}

function validEntry(value: SignatureEntry): boolean {
  return typeof value.signature === 'string'
    && /^[1-9A-HJ-NP-Za-km-z]{64,88}$/u.test(value.signature)
    && typeof value.blockTime === 'number'
    && Number.isSafeInteger(value.blockTime)
    && value.blockTime > 0;
}

function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted ?? false;
}
