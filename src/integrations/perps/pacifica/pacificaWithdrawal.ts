import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

import type { GatewayRequestSigner } from '@/integrations/api/gatewayClient';
import { pacificaPostSigned } from '@/integrations/perps/pacifica/pacificaApi';
import { fetchPacificaPortfolio } from '@/integrations/perps/pacifica/pacificaPortfolio';
import { readTokenBalance } from '@/integrations/solana/stablecoinSwap';

const PREFIX = 'perpal.pacifica.withdrawal.v1.';
const POLL_ATTEMPTS = 6;
const POLL_INTERVAL_MS = 2_000;
const MINIMUM_WITHDRAWAL_BASE_UNITS = 1_000_000n;

type PendingWithdrawal = {
  readonly version: 1;
  readonly account: string;
  readonly amountBaseUnits: string;
  readonly idempotencyKey: string;
  readonly batchNonce: string | null;
  readonly updatedAtMs: number;
};

export async function ensurePacificaCollateralInWallet(
  requestedBaseUnits: bigint,
  input: {
    readonly account: string;
    readonly apiOrigin: string;
    readonly mint: string;
    readonly rpcUrl: string;
    readonly signer: GatewayRequestSigner;
    readonly signal?: AbortSignal;
    readonly withdrawalFeeBaseUnits: bigint;
  },
): Promise<void> {
  if (requestedBaseUnits <= 0n) throw new Error('Withdrawal amount is invalid.');
  const inWallet = await balance(input);
  if (inWallet >= requestedBaseUnits) {
    await clear(input.account);
    return;
  }
  const shortfall = requestedBaseUnits - inWallet;
  const providerAmount = shortfall < MINIMUM_WITHDRAWAL_BASE_UNITS
    ? MINIMUM_WITHDRAWAL_BASE_UNITS
    : shortfall;
  let pending = await read(input.account);
  if (pending !== null && BigInt(pending.amountBaseUnits) !== providerAmount) {
    throw new Error('Resume the pending trading withdrawal before changing the amount.');
  }

  if (pending === null) {
    const portfolio = await fetchPacificaPortfolio(input.apiOrigin, input.account, input.signal);
    const available = usdc(portfolio.availableToWithdraw);
    if (available < providerAmount + input.withdrawalFeeBaseUnits) {
      throw new Error('Your private balance does not have enough withdrawable USDC for this amount and its fee.');
    }
    pending = {
      version: 1,
      account: input.account,
      amountBaseUnits: providerAmount.toString(),
      idempotencyKey: Crypto.randomUUID(),
      batchNonce: null,
      updatedAtMs: Date.now(),
    };
    await write(pending);
  }

  if (pending.batchNonce === null) {
    const response = object(await pacificaPostSigned<unknown>({
      account: input.account,
      apiOrigin: input.apiOrigin,
      operation: 'withdraw',
      payload: {
        amount: formatUsdc(providerAmount),
        idempotency_key: pending.idempotencyKey,
      },
      signer: input.signer,
      signal: input.signal,
    }));
    const batchNonce = String(response.batch_nonce ?? '');
    if (batchNonce.length === 0) throw new Error('The trading withdrawal receipt is invalid.');
    pending = { ...pending, batchNonce, updatedAtMs: Date.now() };
    await write(pending);
  }

  for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt += 1) {
    if (await balance(input) >= requestedBaseUnits) {
      await clear(input.account);
      return;
    }
    await wait(POLL_INTERVAL_MS, input.signal);
  }
  throw new Error('The trading withdrawal is pending. Retry resumes the same request without duplicating it.');
}

export async function hasPendingPacificaWithdrawal(account: string): Promise<boolean> {
  return await read(account) !== null;
}

async function balance(input: {
  readonly account: string;
  readonly mint: string;
  readonly rpcUrl: string;
  readonly signer: GatewayRequestSigner;
  readonly signal?: AbortSignal;
}): Promise<bigint> {
  return readTokenBalance({
    mint: input.mint,
    owner: input.account,
    rpcUrl: input.rpcUrl,
    signer: input.signer,
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  });
}

async function read(account: string): Promise<PendingWithdrawal | null> {
  const value = await SecureStore.getItemAsync(await key(account));
  if (value === null) return null;
  try {
    const record = JSON.parse(value) as Record<string, unknown>;
    if (
      record.version !== 1 ||
      record.account !== account ||
      typeof record.amountBaseUnits !== 'string' ||
      !/^\d+$/u.test(record.amountBaseUnits) ||
      typeof record.idempotencyKey !== 'string' ||
      (record.batchNonce !== null && typeof record.batchNonce !== 'string') ||
      !Number.isSafeInteger(record.updatedAtMs)
    ) throw new Error('invalid');
    return record as unknown as PendingWithdrawal;
  } catch {
    throw new Error('Stored trading-withdrawal recovery state is invalid.');
  }
}

async function write(record: PendingWithdrawal): Promise<void> {
  await SecureStore.setItemAsync(await key(record.account), JSON.stringify(record));
}

async function clear(account: string): Promise<void> {
  await SecureStore.deleteItemAsync(await key(account));
}

async function key(account: string): Promise<string> {
  const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, account);
  return `${PREFIX}${digest}`;
}

function usdc(value: string): bigint {
  if (!/^\d+(?:\.\d{1,6})?$/u.test(value)) throw new Error('The private USDC balance is invalid.');
  const [whole = '0', fraction = ''] = value.split('.');
  return BigInt(`${whole}${fraction.padEnd(6, '0')}`);
}

function formatUsdc(value: bigint): string {
  const digits = value.toString().padStart(7, '0');
  const fraction = digits.slice(-6).replace(/0+$/u, '');
  return fraction.length === 0 ? digits.slice(0, -6) : `${digits.slice(0, -6)}.${fraction}`;
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('The trading withdrawal response is invalid.');
  }
  return value as Record<string, unknown>;
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(new Error('Trading withdrawal cancelled.'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', abort, { once: true });
  });
}
