import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { PublicKey } from '@solana/web3.js';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

import type { GatewayRequestSigner } from '@/integrations/api/gatewayClient';
import { pacificaPostSigned } from '@/integrations/perps/pacifica/pacificaApi';
import { fetchPacificaPortfolio } from '@/integrations/perps/pacifica/pacificaPortfolio';
import {
  openPacificaWithdrawalMonitor,
  type PacificaWithdrawalConfirmation,
} from '@/integrations/perps/pacifica/pacificaWithdrawalStream';
import { signedSolanaRpc } from '@/integrations/api/signedSolanaRpc';
import { readTokenBalance } from '@/integrations/solana/stablecoinSwap';

const PREFIX = 'perpal.pacifica.withdrawal.v1.';
export const PACIFICA_MINIMUM_WITHDRAWAL_BASE_UNITS = 1_000_000n;
const MINIMUM_WITHDRAWAL_BASE_UNITS = PACIFICA_MINIMUM_WITHDRAWAL_BASE_UNITS;
const inFlight = new Map<string, {
  readonly amountBaseUnits: bigint;
  readonly promise: Promise<void>;
}>();
const listeners = new Map<string, Set<() => void>>();

export function availablePacificaReturnBaseUnits(
  availableBaseUnits: bigint,
  withdrawalFeeBaseUnits: bigint,
): bigint {
  // Pacifica's request amount is gross: the venue deducts its fee from that amount before
  // crediting the wallet. The 1 USDC minimum applies to the gross request, not the net receipt.
  if (availableBaseUnits < MINIMUM_WITHDRAWAL_BASE_UNITS) return 0n;
  const credited = availableBaseUnits - withdrawalFeeBaseUnits;
  return credited > 0n ? credited : 0n;
}

type WithdrawalInput = {
  readonly account: string;
  readonly apiOrigin: string;
  readonly mint: string;
  readonly rpcUrl: string;
  readonly signer: GatewayRequestSigner;
  readonly signal?: AbortSignal;
  readonly withdrawalFeeBaseUnits: bigint;
  readonly wsOrigin: string;
};

type PendingWithdrawalBase = {
  readonly account: string;
  readonly amountBaseUnits: string;
  readonly idempotencyKey: string;
  readonly batchNonce: string | null;
  readonly updatedAtMs: number;
};

type PendingWithdrawal = PendingWithdrawalBase & (
  | { readonly version: 1 }
  | { readonly version: 2; readonly targetWalletBalanceBaseUnits: string }
  | { readonly version: 3; readonly feeBaseUnits: string }
);

export async function ensurePacificaCollateralInWallet(
  requestedBaseUnits: bigint,
  input: WithdrawalInput,
): Promise<void> {
  if (requestedBaseUnits <= 0n) throw new Error('Withdrawal amount is invalid.');
  const inWallet = await balance(input);
  if (inWallet >= requestedBaseUnits) return;
  const shortfall = requestedBaseUnits - inWallet;
  const grossRequired = shortfall + input.withdrawalFeeBaseUnits;
  const providerAmount = grossRequired < MINIMUM_WITHDRAWAL_BASE_UNITS
    ? MINIMUM_WITHDRAWAL_BASE_UNITS
    : grossRequired;
  await withdrawToWallet(providerAmount, input);
}

export async function withdrawPacificaCollateralToWallet(
  amountBaseUnits: bigint,
  input: WithdrawalInput,
): Promise<void> {
  if (amountBaseUnits <= 0n) throw new Error('Withdrawal amount is invalid.');
  const grossRequired = amountBaseUnits + input.withdrawalFeeBaseUnits;
  const providerAmount = grossRequired < MINIMUM_WITHDRAWAL_BASE_UNITS
    ? MINIMUM_WITHDRAWAL_BASE_UNITS
    : grossRequired;
  await withdrawToWallet(providerAmount, input);
}

export async function resumePacificaCollateralWithdrawalToWallet(
  input: WithdrawalInput,
): Promise<bigint> {
  const pending = await read(input.account);
  if (pending === null) throw new Error('No Pacifica withdrawal is waiting to resume.');
  const amount = BigInt(pending.amountBaseUnits);
  await withdrawToWallet(amount, input);
  return amount;
}

async function withdrawToWallet(
  providerAmount: bigint,
  input: WithdrawalInput,
): Promise<void> {
  const active = inFlight.get(input.account);
  if (active !== undefined) {
    if (active.amountBaseUnits !== providerAmount) {
      throw new Error('Finish the active Pacifica release before changing the amount.');
    }
    return active.promise;
  }
  const operation = performWithdrawal(providerAmount, input);
  inFlight.set(input.account, { amountBaseUnits: providerAmount, promise: operation });
  try {
    await operation;
  } finally {
    if (inFlight.get(input.account)?.promise === operation) inFlight.delete(input.account);
  }
}

async function performWithdrawal(
  providerAmount: bigint,
  input: WithdrawalInput,
): Promise<void> {
  let pending = await read(input.account);
  if (pending !== null && BigInt(pending.amountBaseUnits) !== providerAmount) {
    throw new Error('Resume the pending trading withdrawal before changing the amount.');
  }

  if (pending === null) {
    const portfolio = await fetchPacificaPortfolio(input.apiOrigin, input.account, input.signal);
    const available = usdc(portfolio.availableToWithdraw);
    if (available < providerAmount) {
      throw new Error('Your private balance does not have enough withdrawable USDC for this amount and its fee.');
    }
    pending = {
      version: 3,
      account: input.account,
      amountBaseUnits: providerAmount.toString(),
      feeBaseUnits: input.withdrawalFeeBaseUnits.toString(),
      idempotencyKey: Crypto.randomUUID(),
      batchNonce: null,
      updatedAtMs: Date.now(),
    };
    await write(pending);
  }

  await assertUsdcDestinationExists(input);
  const monitor = await openPacificaWithdrawalMonitor({
    account: input.account,
    ...(input.signal ? { signal: input.signal } : {}),
    wsOrigin: input.wsOrigin,
  });
  try {
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
      const batchNonce = nonce(response.batch_nonce);
      if (batchNonce === null) throw new Error('The trading withdrawal receipt is invalid.');
      pending = { ...pending, batchNonce, updatedAtMs: Date.now() };
      await write(pending);
      const receipt = withdrawalReceipt(response);
      const expectedFee = pending.version === 3
        ? BigInt(pending.feeBaseUnits)
        : input.withdrawalFeeBaseUnits;
      if (receipt.requestedAmount !== providerAmount || receipt.feeAmount !== expectedFee) {
        throw new Error('Pacifica returned a withdrawal receipt that does not match your review.');
      }
    }

    const batchNonce = pending.batchNonce;
    if (batchNonce === null) throw new Error('The saved Pacifica receipt is incomplete.');
    const confirmation = await monitor.waitFor(batchNonce, input.signal);
    assertConfirmation(confirmation, pending);
    await clear(input.account);
  } finally {
    monitor.close();
  }
}

export async function hasPendingPacificaWithdrawal(account: string): Promise<boolean> {
  return await read(account) !== null;
}

export async function pendingPacificaWithdrawalBaseUnits(
  account: string,
): Promise<bigint | null> {
  const pending = await read(account);
  return pending === null ? null : BigInt(pending.amountBaseUnits);
}

export function subscribePacificaWithdrawal(
  account: string,
  listener: () => void,
): () => void {
  const accountListeners = listeners.get(account) ?? new Set<() => void>();
  accountListeners.add(listener);
  listeners.set(account, accountListeners);
  return () => {
    accountListeners.delete(listener);
    if (accountListeners.size === 0) listeners.delete(account);
  };
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

async function assertUsdcDestinationExists(input: WithdrawalInput): Promise<void> {
  const tokenAccount = getAssociatedTokenAddressSync(
    new PublicKey(input.mint),
    new PublicKey(input.account),
  );
  const account = await signedSolanaRpc<{
    readonly value: null | { readonly owner: string };
  }>({
    method: 'getAccountInfo',
    params: [tokenAccount.toBase58(), { commitment: 'confirmed', encoding: 'base64' }],
    rpcUrl: input.rpcUrl,
    signer: input.signer,
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  });
  if (account.value === null || account.value.owner !== TOKEN_PROGRAM_ID.toBase58()) {
    throw new Error(
      'Private USDC is not ready to receive Pacifica funds. Deposit or receive USDC in the private wallet first, then retry.',
    );
  }
}

function withdrawalReceipt(response: Record<string, unknown>): {
  readonly batchNonce: string;
  readonly feeAmount: bigint;
  readonly requestedAmount: bigint;
} {
  const batchNonce = nonce(response.batch_nonce);
  if (
    batchNonce === null ||
    typeof response.requested_amount !== 'string' ||
    typeof response.fee_amount !== 'string'
  ) throw new Error('The trading withdrawal receipt is invalid.');
  return {
    batchNonce,
    feeAmount: usdc(response.fee_amount),
    requestedAmount: usdc(response.requested_amount),
  };
}

function assertConfirmation(
  confirmation: PacificaWithdrawalConfirmation,
  pending: PendingWithdrawal,
): void {
  const requested = usdc(confirmation.requestedAmount);
  const fee = usdc(confirmation.feeAmount);
  const credited = usdc(confirmation.amount);
  const expectedFee = pending.version === 3 ? BigInt(pending.feeBaseUnits) : fee;
  if (
    confirmation.batchNonce !== pending.batchNonce ||
    requested !== BigInt(pending.amountBaseUnits) ||
    fee !== expectedFee ||
    fee >= requested ||
    credited !== requested - fee
  ) {
    throw new Error(
      'Pacifica confirmed a release that does not match the saved request. The recovery record was kept.',
    );
  }
}

async function read(account: string): Promise<PendingWithdrawal | null> {
  const value = await SecureStore.getItemAsync(await key(account));
  if (value === null) return null;
  try {
    const record = JSON.parse(value) as Record<string, unknown>;
    if (
      (record.version !== 1 && record.version !== 2 && record.version !== 3) ||
      record.account !== account ||
      typeof record.amountBaseUnits !== 'string' ||
      !/^\d+$/u.test(record.amountBaseUnits) ||
      (record.version === 2 && (
        typeof record.targetWalletBalanceBaseUnits !== 'string' ||
        !/^\d+$/u.test(record.targetWalletBalanceBaseUnits)
      )) ||
      (record.version === 3 && (
        typeof record.feeBaseUnits !== 'string' ||
        !/^\d+$/u.test(record.feeBaseUnits)
      )) ||
      typeof record.idempotencyKey !== 'string' ||
      (record.batchNonce !== null && (
        typeof record.batchNonce !== 'string' || nonce(record.batchNonce) === null
      )) ||
      !Number.isSafeInteger(record.updatedAtMs)
    ) throw new Error('invalid');
    return record as unknown as PendingWithdrawal;
  } catch {
    throw new Error('Stored trading-withdrawal recovery state is invalid.');
  }
}

async function write(record: PendingWithdrawal): Promise<void> {
  await SecureStore.setItemAsync(await key(record.account), JSON.stringify(record));
  notify(record.account);
}

async function clear(account: string): Promise<void> {
  await SecureStore.deleteItemAsync(await key(account));
  notify(account);
}

function notify(account: string): void {
  for (const listener of listeners.get(account) ?? []) listener();
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

function nonce(value: unknown): string | null {
  if (typeof value === 'string' && /^\d+$/u.test(value)) return value;
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
    return String(value);
  }
  return null;
}
