import { base64 } from '@scure/base';
import * as Crypto from 'expo-crypto';
import { PublicKey, Transaction } from '@solana/web3.js';

import type { GatewayRequestSigner } from '@/integrations/api/gatewayClient';
import { signedSolanaRpc } from '@/integrations/api/signedSolanaRpc';
import {
  buildVelocityInitializationTransaction,
  velocityAccountSize,
  velocityInitializationAddresses,
  VelocityInitializationError,
  verifyVelocityInitializationPlan,
  type VelocityInitializationTransactionPlan,
} from '@/integrations/perps/velocity/velocityInitializationTransaction';
import {
  signAndSubmitLegacyTransaction,
  type SubmittedTransactionResult,
} from '@/integrations/solana/signedLegacyTransaction';

export { VelocityInitializationError };

const PLAN_LIFETIME_MS = 60_000;

export type VelocityInitializationPlan = VelocityInitializationTransactionPlan & {
  readonly lastValidBlockHeight: number;
  readonly balanceLamports: bigint;
  readonly rentLamports: bigint;
  readonly feeLamports: bigint;
  readonly requiredLamports: bigint;
  readonly simulation: 'passed' | 'insufficient-balance';
  readonly expiresAtMs: number;
  readonly idempotencyKey: string;
};

export type VelocityInitializationResult = SubmittedTransactionResult;

type PrepareInput = {
  readonly owner: string;
  readonly programId: string;
  readonly rpcUrl: string;
  readonly signer: GatewayRequestSigner;
  readonly signal?: AbortSignal;
};

type SubmitInput = PrepareInput & {
  readonly plan: VelocityInitializationPlan;
};

type RpcAccount = { readonly owner: string } | null;
type AccountSet = {
  readonly context: { readonly slot: number };
  readonly value: readonly RpcAccount[];
};
type BalanceResult = {
  readonly context: { readonly slot: number };
  readonly value: number;
};
type BlockhashResult = {
  readonly context: { readonly slot: number };
  readonly value: {
    readonly blockhash: string;
    readonly lastValidBlockHeight: number;
  };
};
type ContextValue<T> = {
  readonly context: { readonly slot: number };
  readonly value: T;
};

export async function prepareVelocityAccountInitialization({
  owner,
  programId,
  rpcUrl,
  signer,
  signal,
}: PrepareInput): Promise<VelocityInitializationPlan> {
  const addresses = velocityInitializationAddresses(programId, owner);
  assertSigner(owner, signer);

  const [accounts, blockhash, balance] = await Promise.all([
    signedSolanaRpc<AccountSet>({
      method: 'getMultipleAccounts',
      params: [
        [addresses.userAccount, addresses.userStatsAccount],
        { commitment: 'confirmed', encoding: 'base64' },
      ],
      rpcUrl,
      signer,
      ...(signal === undefined ? {} : { signal }),
    }),
    signedSolanaRpc<BlockhashResult>({
      method: 'getLatestBlockhash',
      params: [{ commitment: 'confirmed' }],
      rpcUrl,
      signer,
      ...(signal === undefined ? {} : { signal }),
    }),
    signedSolanaRpc<BalanceResult>({
      method: 'getBalance',
      params: [owner, { commitment: 'confirmed' }],
      rpcUrl,
      signer,
      ...(signal === undefined ? {} : { signal }),
    }),
  ]);

  const [userAccount, userStatsAccount] = validateAccountSet(accounts, programId);

  if (userAccount !== null) {
    throw new VelocityInitializationError(
      'The Velocity account is already initialized.',
      'already_initialized',
    );
  }

  const includeUserStats = userStatsAccount === null;
  const transaction = buildVelocityInitializationTransaction({
    ...addresses,
    includeUserStats,
    programId,
    recentBlockhash: blockhash.value.blockhash,
  });
  const message = base64.encode(transaction.serializeMessage());
  const rentRequests = [accountRent('User', rpcUrl, signer, signal)];

  if (includeUserStats) {
    rentRequests.push(accountRent('UserStats', rpcUrl, signer, signal));
  }

  const [rents, fee] = await Promise.all([
    Promise.all(rentRequests),
    signedSolanaRpc<ContextValue<number | null>>({
      method: 'getFeeForMessage',
      params: [message, { commitment: 'confirmed' }],
      rpcUrl,
      signer,
      ...(signal === undefined ? {} : { signal }),
    }),
  ]);

  if (fee.value === null || !Number.isSafeInteger(fee.value) || fee.value < 0) {
    throw new VelocityInitializationError(
      'The network fee could not be calculated.',
      'fee_unavailable',
    );
  }

  const rentLamports = rents.reduce((total, rent) => total + rent, 0n);
  const feeLamports = BigInt(fee.value);
  const balanceLamports = safeLamports(balance.value, 'wallet balance');
  const requiredLamports = rentLamports + feeLamports;
  const simulation = balanceLamports < requiredLamports
    ? 'insufficient-balance'
    : await simulateInitialization(transaction, rpcUrl, signer, signal);

  const plan: VelocityInitializationPlan = {
    ...addresses,
    includeUserStats,
    unsignedTransaction: transaction.serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    }),
    recentBlockhash: blockhash.value.blockhash,
    lastValidBlockHeight: blockhash.value.lastValidBlockHeight,
    balanceLamports,
    rentLamports,
    feeLamports,
    requiredLamports,
    simulation,
    expiresAtMs: Date.now() + PLAN_LIFETIME_MS,
    idempotencyKey: Crypto.randomUUID(),
  };

  verifyVelocityInitializationPlan(plan, programId);
  return plan;
}

export async function submitVelocityAccountInitialization({
  owner,
  programId,
  rpcUrl,
  signer,
  signal,
  plan,
}: SubmitInput): Promise<VelocityInitializationResult> {
  assertSigner(owner, signer);
  verifyVelocityInitializationPlan(plan, programId);

  if (plan.owner !== owner || Date.now() >= plan.expiresAtMs) {
    throw new VelocityInitializationError(
      'The initialization plan expired. Prepare it again.',
      'plan_expired',
    );
  }

  if (plan.simulation !== 'passed' || plan.balanceLamports < plan.requiredLamports) {
    throw new VelocityInitializationError(
      'The trading wallet needs more SOL before initialization.',
      'insufficient_sol',
    );
  }

  const userAccount = await signedSolanaRpc<ContextValue<RpcAccount>>({
    method: 'getAccountInfo',
    params: [plan.userAccount, { commitment: 'confirmed', encoding: 'base64' }],
    rpcUrl,
    signer,
    ...(signal === undefined ? {} : { signal }),
  });

  if (userAccount.value !== null) {
    throw new VelocityInitializationError(
      'The Velocity account is already initialized.',
      'already_initialized',
    );
  }

  return signAndSubmitLegacyTransaction({
    idempotencyKey: plan.idempotencyKey,
    owner,
    rpcUrl,
    signer,
    unsignedTransaction: plan.unsignedTransaction,
    ...(signal === undefined ? {} : { signal }),
  });
}

async function accountRent(
  account: 'User' | 'UserStats',
  rpcUrl: string,
  signerValue: GatewayRequestSigner,
  signal?: AbortSignal,
): Promise<bigint> {
  const lamports = await signedSolanaRpc<number>({
    method: 'getMinimumBalanceForRentExemption',
    params: [velocityAccountSize(account), { commitment: 'confirmed' }],
    rpcUrl,
    signer: signerValue,
    ...(signal === undefined ? {} : { signal }),
  });

  return safeLamports(lamports, `${account} rent`);
}

async function simulateInitialization(
  transaction: Transaction,
  rpcUrl: string,
  signer: GatewayRequestSigner,
  signal?: AbortSignal,
): Promise<'passed'> {
  const result = await signedSolanaRpc<ContextValue<{
    readonly err: unknown;
  }>>({
    method: 'simulateTransaction',
    params: [
      base64.encode(
        transaction.serialize({
          requireAllSignatures: false,
          verifySignatures: false,
        }),
      ),
      {
        commitment: 'confirmed',
        encoding: 'base64',
        replaceRecentBlockhash: false,
        sigVerify: false,
      },
    ],
    rpcUrl,
    signer,
    timeoutMs: 12_000,
    ...(signal === undefined ? {} : { signal }),
  });

  if (result.value.err !== null) {
    throw new VelocityInitializationError(
      'Velocity rejected the initialization preview.',
      'simulation_failed',
    );
  }

  return 'passed';
}

function validateAccountSet(
  result: AccountSet,
  programId: string,
): readonly [RpcAccount, RpcAccount] {
  const [user, stats] = result.value;

  if (
    !Number.isSafeInteger(result.context.slot) ||
    result.value.length !== 2 ||
    user === undefined ||
    stats === undefined ||
    (user !== null && user.owner !== programId) ||
    (stats !== null && stats.owner !== programId)
  ) {
    throw new VelocityInitializationError(
      'Velocity returned unexpected account state.',
      'account_state_invalid',
    );
  }

  return [user, stats];
}

function assertSigner(owner: string, signer: GatewayRequestSigner): void {
  if (!new PublicKey(signer.publicKey).equals(new PublicKey(owner))) {
    throw new VelocityInitializationError(
      'The active trading signer does not match the selected wallet.',
      'signer_mismatch',
    );
  }
}

function safeLamports(value: number, label: string): bigint {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new VelocityInitializationError(
      `The ${label} is invalid.`,
      'rpc_value_invalid',
    );
  }

  return BigInt(value);
}
