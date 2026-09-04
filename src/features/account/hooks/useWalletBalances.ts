import {
  getAssociatedTokenAddressSync,
  NATIVE_MINT,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { PublicKey } from '@solana/web3.js';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

import { readAppConfig } from '@/config/appConfig';
import {
  valueTokenHoldingsUsd,
  type TokenHolding,
} from '@/domain/money/tokenValuation';
import type { GatewayRequestSigner } from '@/integrations/api/gatewayClient';
import { signedSolanaRpc } from '@/integrations/api/signedSolanaRpc';
import {
  fetchTokenPrices,
  type TokenPriceBatch,
} from '@/integrations/market-data/tokenPrices';

export type WalletValuation = {
  readonly source: 'Jupiter Price API V3';
  readonly timestampMs: number;
  readonly unpricedAssetCount: number;
  readonly usdBaseUnits: bigint;
};

export type WalletBalance = {
  readonly holdings: readonly TokenHolding[];
  readonly solLamports: bigint;
  /** Spendable balance in the wallet's canonical token account. Full holdings remain in `holdings`. */
  readonly usdcBaseUnits: bigint;
  readonly usdtBaseUnits: bigint;
  readonly valuation: WalletValuation | null;
};

export type WalletBalances = {
  readonly publicWallet: WalletBalance | null;
  readonly privateWallet: WalletBalance | null;
};

type RawWalletBalance = Omit<WalletBalance, 'valuation'>;
type TokenAccountHolding = TokenHolding & {
  readonly address: string;
};

type BalanceStatus = 'idle' | 'loading' | 'ready' | 'error';
const REFRESH_INTERVAL_MS = 30_000;
const PRICE_CACHE_MAX_AGE_MS = 120_000;
const STARTUP_RETRY_LIMIT = 3;
const STARTUP_RETRY_MS = 1_000;

export function useWalletBalances(input: {
  readonly privateAddress: string | null;
  readonly publicAddress: string | null;
  readonly signer: GatewayRequestSigner | null;
}) {
  const [balances, setBalances] = useState<WalletBalances | null>(null);
  const [status, setStatus] = useState<BalanceStatus>('idle');
  const [refreshRevision, setRefreshRevision] = useState(0);
  const hasBalances = useRef(false);
  const balancesRef = useRef<WalletBalances | null>(null);
  const pricingRef = useRef<TokenPriceBatch | null>(null);
  const refresh = useCallback(() => setRefreshRevision((value) => value + 1), []);

  useEffect(() => {
    hasBalances.current = false;
    balancesRef.current = null;
    setBalances(null);
    setStatus(
      (input.privateAddress !== null || input.publicAddress !== null) && input.signer !== null
        ? 'loading'
        : 'idle',
    );
  }, [input.privateAddress, input.publicAddress, input.signer]);

  useFocusEffect(
    useCallback(() => {
      const config = readAppConfig();
      const signer = input.signer;
      if (
        !config.ok ||
        (input.privateAddress === null && input.publicAddress === null) ||
        signer === null
      ) {
        return undefined;
      }

      let active = true;
      let controller: AbortController | null = null;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let startupFailures = 0;

      const load = async () => {
        controller?.abort();
        controller = new AbortController();
        if (!hasBalances.current) setStatus('loading');

        try {
          const [publicResult, privateResult] = await Promise.allSettled([
            input.publicAddress === null
              ? Promise.resolve(null)
              : readWalletBalance(
                  input.publicAddress,
                  signer,
                  config.value.api.rpcUrl,
                  config.value.perps.usdcMint,
                  config.value.perps.usdtMint,
                  controller.signal,
                ),
            input.privateAddress === null
              ? Promise.resolve(null)
              : readWalletBalance(
                  input.privateAddress,
                  signer,
                  config.value.api.rpcUrl,
                  config.value.perps.usdcMint,
                  config.value.perps.usdtMint,
                  controller.signal,
                ),
          ]);
          const previous = balancesRef.current;
          const publicWallet = resolvedWallet(publicResult, previous?.publicWallet ?? null);
          const privateWallet = resolvedWallet(privateResult, previous?.privateWallet ?? null);
          if (publicWallet === null && privateWallet === null) {
            throw firstRejected(publicResult, privateResult);
          }

          if (active) {
            startupFailures = 0;
            hasBalances.current = true;
            const cachedPricing = currentPricing(pricingRef.current);
            const raw = {
              publicWallet: walletWithPricing(publicWallet, cachedPricing),
              privateWallet: walletWithPricing(privateWallet, cachedPricing),
            };
            balancesRef.current = raw;
            setBalances(raw);
            setStatus('ready');
          }

          const pricing = await fetchTokenPrices(
            uniqueMints([
              ...(publicWallet?.holdings ?? []),
              ...(privateWallet?.holdings ?? []),
              ...((publicWallet?.solLamports ?? 0n) === 0n &&
                (privateWallet?.solLamports ?? 0n) === 0n
                ? []
                : [{ mint: NATIVE_MINT.toBase58(), baseUnits: 1n, decimals: 9 }]),
            ]),
            config.value.api.tokenPricesUrl,
            controller.signal,
          ).catch((cause) => {
            if (active && !controller?.signal.aborted) {
              logWalletBalanceFailure(cause, startupFailures + 1, 'pricing');
            }
            return null;
          });

          if (active) {
            if (pricing !== null) {
              pricingRef.current = pricing;
              const valued = {
                publicWallet: walletWithPricing(publicWallet, pricing),
                privateWallet: walletWithPricing(privateWallet, pricing),
              };
              balancesRef.current = valued;
              setBalances(valued);
            }
          }
        } catch (cause) {
          if (active && !controller.signal.aborted && !hasBalances.current) {
            startupFailures += 1;
            setStatus(startupFailures >= STARTUP_RETRY_LIMIT ? 'error' : 'loading');
            logWalletBalanceFailure(cause, startupFailures, 'wallets');
          }
        } finally {
          if (active) {
            const delay = hasBalances.current || startupFailures >= STARTUP_RETRY_LIMIT
              ? REFRESH_INTERVAL_MS
              : STARTUP_RETRY_MS * startupFailures;
            timer = setTimeout(() => void load(), delay);
          }
        }
      };

      void load();
      return () => {
        active = false;
        controller?.abort();
        if (timer !== undefined) clearTimeout(timer);
      };
    }, [input.privateAddress, input.publicAddress, input.signer, refreshRevision]),
  );

  return { balances, refresh, status };
}

function logWalletBalanceFailure(
  cause: unknown,
  attempt: number,
  scope: 'pricing' | 'wallets',
): void {
  if (!__DEV__) return;
  const value = typeof cause === 'object' && cause !== null
    ? cause as {
        readonly code?: unknown;
        readonly name?: unknown;
        readonly status?: unknown;
        readonly traceId?: unknown;
      }
    : null;
  console.warn('[Perpal wallet balances failed]', {
    attempt,
    scope,
    errorCode: typeof value?.code === 'string' ? value.code : 'unknown',
    errorName: cause instanceof Error ? cause.name : typeof value?.name === 'string' ? value.name : typeof cause,
    ...(typeof value?.status === 'number' && Number.isInteger(value.status)
      ? { status: value.status }
      : {}),
    ...(typeof value?.traceId === 'string' ? { traceId: value.traceId } : {}),
  });
}

function resolvedWallet(
  result: PromiseSettledResult<RawWalletBalance | null>,
  previous: WalletBalance | null,
): RawWalletBalance | WalletBalance | null {
  return result.status === 'fulfilled' ? result.value : previous;
}

function firstRejected(
  ...results: readonly PromiseSettledResult<RawWalletBalance | null>[]
): unknown {
  return results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
    ?.reason ?? new Error('Wallet balances are unavailable.');
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
  const tokenAccounts = [...legacy, ...token2022];
  const holdings = mergeHoldings(tokenAccounts);

  return {
    holdings,
    solLamports,
    usdcBaseUnits: associatedTokenAmount(tokenAccounts, owner, usdcMint),
    usdtBaseUnits: associatedTokenAmount(tokenAccounts, owner, usdtMint),
  };
}

async function readTokenHoldings(
  owner: string,
  programId: string,
  rpcUrl: string,
  signer: GatewayRequestSigner,
  signal: AbortSignal,
): Promise<readonly TokenAccountHolding[]> {
  const result = await signedSolanaRpc<{
    readonly value: readonly {
      readonly pubkey: string;
      readonly account: { readonly data: unknown };
    }[];
  }>({
    method: 'getTokenAccountsByOwner',
    params: [owner, { programId }, { commitment: 'confirmed', encoding: 'jsonParsed' }],
    rpcUrl,
    signal,
    signer,
  });

  return result.value.map((entry) => ({
    ...parseTokenHolding(entry.account.data, owner),
    address: new PublicKey(entry.pubkey).toBase58(),
  }));
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

function associatedTokenAmount(
  accounts: readonly TokenAccountHolding[],
  owner: string,
  mint: string,
): bigint {
  const ownerKey = new PublicKey(owner);
  const mintKey = new PublicKey(mint);
  const addresses = new Set([
    getAssociatedTokenAddressSync(mintKey, ownerKey, false, TOKEN_PROGRAM_ID).toBase58(),
    getAssociatedTokenAddressSync(mintKey, ownerKey, false, TOKEN_2022_PROGRAM_ID).toBase58(),
  ]);
  return accounts.reduce(
    (total, account) => account.mint === mint && addresses.has(account.address)
      ? total + account.baseUnits
      : total,
    0n,
  );
}

function uniqueMints(holdings: readonly TokenHolding[]): readonly string[] {
  return [...new Set(holdings.map((holding) => holding.mint))];
}

function withValuation(
  wallet: RawWalletBalance,
  pricing: TokenPriceBatch,
): WalletBalance {
  const valuation = valueTokenHoldingsUsd(
    mergeHoldings([
      ...wallet.holdings,
      ...(wallet.solLamports === 0n
        ? []
        : [{ mint: NATIVE_MINT.toBase58(), baseUnits: wallet.solLamports, decimals: 9 }]),
    ]),
    pricing.prices,
  );
  return {
    ...wallet,
    valuation: {
      ...valuation,
      source: 'Jupiter Price API V3',
      timestampMs: pricing.timestampMs,
    },
  };
}

function walletWithPricing(
  wallet: RawWalletBalance | WalletBalance | null,
  pricing: TokenPriceBatch | null,
): WalletBalance | null {
  if (wallet === null) return null;
  if (pricing !== null) return withValuation(wallet, pricing);
  return { ...wallet, valuation: null };
}

function currentPricing(pricing: TokenPriceBatch | null): TokenPriceBatch | null {
  return pricing !== null && Date.now() - pricing.timestampMs <= PRICE_CACHE_MAX_AGE_MS
    ? pricing
    : null;
}
