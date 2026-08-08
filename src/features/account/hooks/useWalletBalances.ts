import {
  NATIVE_MINT,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

import { readAppConfig } from '@/config/appConfig';
import {
  valueTokenHoldingsUsd,
  type TokenHolding,
} from '@/domain/money/tokenValuation';
import type { GatewayRequestSigner } from '@/integrations/api/gatewayClient';
import { signedSolanaRpc } from '@/integrations/api/signedSolanaRpc';

export type WalletValuation = {
  readonly source: 'Jupiter Price API V3';
  readonly timestampMs: number;
  readonly unpricedAssetCount: number;
  readonly usdBaseUnits: bigint;
};

export type WalletBalance = {
  readonly solLamports: bigint;
  readonly usdcBaseUnits: bigint;
  readonly usdtBaseUnits: bigint;
  readonly valuation: WalletValuation | null;
};

export type WalletBalances = {
  readonly publicWallet: WalletBalance;
  readonly privateWallet: WalletBalance;
};

type RawWalletBalance = Omit<WalletBalance, 'valuation'> & {
  readonly holdings: readonly TokenHolding[];
};

type BalanceStatus = 'idle' | 'loading' | 'ready' | 'error';
type PriceBatch = {
  readonly prices: ReadonlyMap<string, string>;
  readonly timestampMs: number;
};

const PRICE_BATCH_SIZE = 50;
const REFRESH_INTERVAL_MS = 30_000;

export function useWalletBalances(input: {
  readonly privateAddress: string | null;
  readonly publicAddress: string | null;
  readonly signer: GatewayRequestSigner | null;
}) {
  const [balances, setBalances] = useState<WalletBalances | null>(null);
  const [status, setStatus] = useState<BalanceStatus>('idle');
  const hasBalances = useRef(false);

  useEffect(() => {
    hasBalances.current = false;
    setBalances(null);
    setStatus(
      input.privateAddress !== null &&
      input.publicAddress !== null &&
      input.signer !== null
        ? 'loading'
        : 'idle',
    );
  }, [input.privateAddress, input.publicAddress, input.signer]);

  useFocusEffect(
    useCallback(() => {
      const config = readAppConfig();
      if (
        !config.ok ||
        input.privateAddress === null ||
        input.publicAddress === null ||
        input.signer === null
      ) {
        return undefined;
      }

      let active = true;
      let controller: AbortController | null = null;
      let timer: ReturnType<typeof setTimeout> | undefined;

      const load = async () => {
        controller?.abort();
        controller = new AbortController();
        if (!hasBalances.current) setStatus('loading');

        try {
          const [publicWallet, privateWallet] = await Promise.all([
            readWalletBalance(
              input.publicAddress!,
              input.signer!,
              config.value.api.rpcUrl,
              config.value.perps.usdcMint,
              config.value.perps.usdtMint,
              controller.signal,
            ),
            readWalletBalance(
              input.privateAddress!,
              input.signer!,
              config.value.api.rpcUrl,
              config.value.perps.usdcMint,
              config.value.perps.usdtMint,
              controller.signal,
            ),
          ]);

          let pricing: PriceBatch | null = null;
          try {
            pricing = await fetchTokenPrices(
              uniqueMints([...publicWallet.holdings, ...privateWallet.holdings]),
              config.value.api.tokenPricesUrl,
              controller.signal,
            );
          } catch {
            // Raw balances stay usable when the independent display-price feed is unavailable.
          }

          if (active) {
            hasBalances.current = true;
            setBalances({
              publicWallet: withValuation(publicWallet, pricing),
              privateWallet: withValuation(privateWallet, pricing),
            });
            setStatus('ready');
          }
        } catch {
          if (active && !controller.signal.aborted && !hasBalances.current) {
            setStatus('error');
          }
        } finally {
          if (active) timer = setTimeout(() => void load(), REFRESH_INTERVAL_MS);
        }
      };

      void load();
      return () => {
        active = false;
        controller?.abort();
        if (timer !== undefined) clearTimeout(timer);
      };
    }, [input.privateAddress, input.publicAddress, input.signer]),
  );

  return { balances, status };
}

async function readWalletBalance(
  owner: string,
  signer: GatewayRequestSigner,
  rpcUrl: string,
  usdcMint: string,
  usdtMint: string,
  signal: AbortSignal,
): Promise<RawWalletBalance> {
  const [sol, legacy, token2022] = await Promise.all([
    signedSolanaRpc<{ readonly value: number }>({
      method: 'getBalance',
      params: [owner, { commitment: 'confirmed' }],
      rpcUrl,
      signal,
      signer,
    }),
    readTokenHoldings(owner, TOKEN_PROGRAM_ID.toBase58(), rpcUrl, signer, signal),
    readTokenHoldings(owner, TOKEN_2022_PROGRAM_ID.toBase58(), rpcUrl, signer, signal),
  ]);
  if (!Number.isSafeInteger(sol.value) || sol.value < 0) {
    throw new Error('SOL balance is invalid.');
  }

  const solLamports = BigInt(sol.value);
  const holdings = mergeHoldings([
    ...legacy,
    ...token2022,
    ...(solLamports === 0n
      ? []
      : [{ mint: NATIVE_MINT.toBase58(), baseUnits: solLamports, decimals: 9 }]),
  ]);

  return {
    holdings,
    solLamports,
    usdcBaseUnits: holdingAmount(holdings, usdcMint),
    usdtBaseUnits: holdingAmount(holdings, usdtMint),
  };
}

async function readTokenHoldings(
  owner: string,
  programId: string,
  rpcUrl: string,
  signer: GatewayRequestSigner,
  signal: AbortSignal,
): Promise<readonly TokenHolding[]> {
  const result = await signedSolanaRpc<{
    readonly value: readonly { readonly account: { readonly data: unknown } }[];
  }>({
    method: 'getTokenAccountsByOwner',
    params: [owner, { programId }, { commitment: 'confirmed', encoding: 'jsonParsed' }],
    rpcUrl,
    signal,
    signer,
  });

  return result.value.map((entry) => parseTokenHolding(entry.account.data, owner));
}

function parseTokenHolding(value: unknown, owner: string): TokenHolding {
  const record = object(value);
  const parsed = object(record.parsed);
  const info = object(parsed.info);
  const tokenAmount = object(info.tokenAmount);
  const amount = tokenAmount.amount;
  const decimals = tokenAmount.decimals;
  const mint = info.mint;

  if (
    info.owner !== owner ||
    typeof mint !== 'string' ||
    typeof amount !== 'string' ||
    !/^\d+$/u.test(amount) ||
    !Number.isInteger(decimals) ||
    (decimals as number) < 0 ||
    (decimals as number) > 255
  ) {
    throw new Error('Token balance is invalid.');
  }

  return { mint, baseUnits: BigInt(amount), decimals: decimals as number };
}

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Token balance is invalid.');
  }
  return value as Record<string, unknown>;
}

function mergeHoldings(holdings: readonly TokenHolding[]): readonly TokenHolding[] {
  const merged = new Map<string, TokenHolding>();

  for (const holding of holdings) {
    if (holding.baseUnits === 0n) continue;
    const current = merged.get(holding.mint);
    if (current !== undefined && current.decimals !== holding.decimals) {
      throw new Error('Token decimals are inconsistent.');
    }
    merged.set(holding.mint, {
      ...holding,
      baseUnits: (current?.baseUnits ?? 0n) + holding.baseUnits,
    });
  }

  return [...merged.values()];
}

function holdingAmount(holdings: readonly TokenHolding[], mint: string): bigint {
  return holdings.find((holding) => holding.mint === mint)?.baseUnits ?? 0n;
}

function uniqueMints(holdings: readonly TokenHolding[]): readonly string[] {
  return [...new Set(holdings.map((holding) => holding.mint))];
}

async function fetchTokenPrices(
  mints: readonly string[],
  tokenPricesUrl: string,
  signal: AbortSignal,
): Promise<PriceBatch> {
  if (mints.length === 0) return { prices: new Map(), timestampMs: Date.now() };

  const chunks = Array.from(
    { length: Math.ceil(mints.length / PRICE_BATCH_SIZE) },
    (_, index) => mints.slice(index * PRICE_BATCH_SIZE, (index + 1) * PRICE_BATCH_SIZE),
  );
  const batches = await Promise.all(
    chunks.map((ids) => fetchPriceBatch(ids, tokenPricesUrl, signal)),
  );

  return {
    prices: new Map(batches.flatMap((batch) => [...batch.prices.entries()])),
    timestampMs: Math.min(...batches.map((batch) => batch.timestampMs)),
  };
}

async function fetchPriceBatch(
  ids: readonly string[],
  tokenPricesUrl: string,
  signal: AbortSignal,
): Promise<PriceBatch> {
  const url = new URL(tokenPricesUrl);
  url.searchParams.set('ids', ids.join(','));
  const response = await fetch(url, { headers: { accept: 'application/json' }, signal });
  const payload = await response.json().catch(() => null) as unknown;
  const body = object(payload);
  const rawPrices = object(body.prices);

  if (
    !response.ok ||
    body.source !== 'Jupiter Price API V3' ||
    !Number.isSafeInteger(body.timestampMs) ||
    (body.timestampMs as number) <= 0
  ) {
    throw new Error('Token prices are invalid.');
  }

  const allowed = new Set(ids);
  const prices = new Map<string, string>();
  for (const [mint, price] of Object.entries(rawPrices)) {
    if (!allowed.has(mint) || typeof price !== 'string' || !/^\d+(?:\.\d{1,18})?$/u.test(price)) {
      throw new Error('Token prices are invalid.');
    }
    prices.set(mint, price);
  }

  return { prices, timestampMs: body.timestampMs as number };
}

function withValuation(
  wallet: RawWalletBalance,
  pricing: PriceBatch | null,
): WalletBalance {
  const { holdings, ...balance } = wallet;
  if (pricing === null) return { ...balance, valuation: null };

  const valuation = valueTokenHoldingsUsd(holdings, pricing.prices);
  return {
    ...balance,
    valuation: {
      ...valuation,
      source: 'Jupiter Price API V3',
      timestampMs: pricing.timestampMs,
    },
  };
}
