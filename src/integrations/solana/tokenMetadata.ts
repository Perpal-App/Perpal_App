import { PublicKey } from '@solana/web3.js';

import type { GatewayRequestSigner } from '@/integrations/api/gatewayClient';
import { signedSolanaRpc } from '@/integrations/api/signedSolanaRpc';

export type TokenMetadata = {
  readonly imageUrl: string | null;
  readonly mint: string;
  readonly symbol: string | null;
};

export type TokenMetadataMap = ReadonlyMap<string, TokenMetadata>;

type CacheEntry = {
  readonly expiresAtMs: number;
  readonly metadata: TokenMetadata | null;
};

const CACHE_MAX_AGE_MS = 24 * 60 * 60_000;
const MAX_CACHE_ENTRIES = 512;
const BATCH_SIZE = 100;
const cache = new Map<string, CacheEntry>();

/**
 * Reads token identity from Helius DAS through the authenticated RPC gateway.
 *
 * Only the image URL explicitly returned in `content.links.image` is accepted. Missing or invalid
 * metadata remains missing: callers must not substitute a bundled mark, initials, or another
 * provider's symbol catalog.
 */
export async function fetchTokenMetadata(
  mints: readonly string[],
  rpcUrl: string,
  signer: GatewayRequestSigner,
  signal: AbortSignal,
): Promise<TokenMetadataMap> {
  const requested = validUniqueMints(mints);
  const result = new Map<string, TokenMetadata>();
  const missing: string[] = [];
  const now = Date.now();

  for (const mint of requested) {
    const cached = cache.get(mint);
    if (cached !== undefined && cached.expiresAtMs > now) {
      if (cached.metadata !== null) result.set(mint, cached.metadata);
    } else {
      if (cached !== undefined) cache.delete(mint);
      missing.push(mint);
    }
  }

  for (let offset = 0; offset < missing.length; offset += BATCH_SIZE) {
    if (signal.aborted) throw new Error('Token metadata request was cancelled.');
    const batch = missing.slice(offset, offset + BATCH_SIZE);
    const values = await signedSolanaRpc<readonly unknown[]>({
      method: 'getAssetBatch',
      params: { ids: batch, options: { showFungible: true } },
      rpcUrl,
      signal,
      signer,
    });
    if (!Array.isArray(values)) throw new Error('Token metadata response is invalid.');

    const parsed = new Map<string, TokenMetadata>();
    for (const value of values) {
      const metadata = parseTokenMetadata(value, batch);
      if (metadata !== null) parsed.set(metadata.mint, metadata);
    }
    const expiresAtMs = Date.now() + CACHE_MAX_AGE_MS;
    for (const mint of batch) {
      const metadata = parsed.get(mint) ?? null;
      cache.set(mint, { expiresAtMs, metadata });
      if (metadata !== null) result.set(mint, metadata);
    }
    trimCache();
  }

  return result;
}

function parseTokenMetadata(
  value: unknown,
  requested: readonly string[],
): TokenMetadata | null {
  const asset = record(value);
  if (asset === null) return null;
  const mint = typeof asset.id === 'string' ? asset.id : null;
  if (mint === null || !requested.includes(mint)) return null;

  const content = record(asset.content);
  const links = record(content?.links);
  const metadata = record(content?.metadata);
  return {
    imageUrl: httpsUrl(links?.image),
    mint,
    symbol: boundedSymbol(metadata?.symbol),
  };
}

function validUniqueMints(values: readonly string[]): readonly string[] {
  const result = new Set<string>();
  for (const value of values) {
    try {
      const mint = new PublicKey(value).toBase58();
      if (mint === value) result.add(mint);
    } catch {
      // Invalid holdings are already rejected by the balance parser. Ignore an invalid optional
      // metadata key rather than making balances unavailable.
    }
  }
  return [...result];
}

function boundedSymbol(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const symbol = value.trim();
  return symbol.length > 0 && symbol.length <= 16 ? symbol : null;
}

function httpsUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2_048) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function trimCache(): void {
  while (cache.size > MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value as string | undefined;
    if (oldest === undefined) return;
    cache.delete(oldest);
  }
}
