import { base64 } from '@scure/base';
import { Buffer } from 'buffer';
import { PublicKey, Transaction } from '@solana/web3.js';
import * as Crypto from 'expo-crypto';

import type { GatewayRequestSigner } from '@/integrations/api/gatewayClient';
import { signedSolanaRpc } from '@/integrations/api/signedSolanaRpc';
import { createPacificaDepositInstruction } from '@/integrations/perps/pacifica/pacificaDepositInstruction';
import { readTokenBalance } from '@/integrations/solana/stablecoinSwap';
import {
  signAndSubmitLegacyTransaction,
  type SubmittedTransactionResult,
} from '@/integrations/solana/signedLegacyTransaction';

const PLAN_LIFETIME_MS = 45_000;

// Pacifica does not expose this as account metadata. Its public protocol docs state that
// smaller deposits are not credited, so the client must not submit them and strand funds.
export const PACIFICA_MINIMUM_CREDITED_DEPOSIT_BASE_UNITS = 10_000_000n;

export type PacificaDepositPlan = {
  readonly amountBaseUnits: bigint;
  readonly expiresAtMs: number;
  readonly feeLamports: bigint;
  readonly idempotencyKey: string;
  readonly owner: string;
  /** Exact Pacifica cash balance before this deposit, used to prove backend credit. */
  readonly providerBalanceBeforeBaseUnits: bigint;
  readonly simulation: 'passed' | 'insufficient-token' | 'insufficient-sol';
  readonly solBalanceLamports: bigint;
  readonly tokenBalanceBaseUnits: bigint;
  readonly unsignedTransaction: Uint8Array;
};

export async function preparePacificaDeposit(input: {
  readonly amountBaseUnits: bigint;
  readonly centralState: string;
  readonly mint: string;
  readonly owner: string;
  readonly programId: string;
  readonly providerBalanceBeforeBaseUnits: bigint;
  readonly rpcUrl: string;
  readonly signer: GatewayRequestSigner;
  readonly signal?: AbortSignal;
  readonly vault: string;
}): Promise<PacificaDepositPlan> {
  if (
    input.amountBaseUnits < PACIFICA_MINIMUM_CREDITED_DEPOSIT_BASE_UNITS ||
    input.amountBaseUnits > 0xffff_ffff_ffff_ffffn
  ) {
    throw new Error('Pacifica requires a credited deposit of at least 10 USDC.');
  }
  const owner = new PublicKey(input.owner);
  const programId = new PublicKey(input.programId);
  if (!owner.equals(new PublicKey(input.signer.publicKey))) {
    throw new Error('The private trading identity does not match the Pacifica deposit signer.');
  }

  const [blockhash, tokenBalanceBaseUnits, solBalance] = await Promise.all([
    signedSolanaRpc<{ readonly value: { readonly blockhash: string } }>({
      method: 'getLatestBlockhash',
      params: [{ commitment: 'confirmed' }],
      rpcUrl: input.rpcUrl,
      signer: input.signer,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    }),
    readTokenBalance({
      mint: input.mint,
      owner: input.owner,
      rpcUrl: input.rpcUrl,
      signer: input.signer,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    }),
    signedSolanaRpc<{ readonly value: number }>({
      method: 'getBalance',
      params: [input.owner, { commitment: 'confirmed' }],
      rpcUrl: input.rpcUrl,
      signer: input.signer,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    }),
  ]);
  if (!Number.isSafeInteger(solBalance.value) || solBalance.value < 0) {
    throw new Error('Private trading returned an invalid SOL balance.');
  }

  const transaction = new Transaction({
    feePayer: owner,
    recentBlockhash: blockhash.value.blockhash,
  }).add(createPacificaDepositInstruction(input, owner, programId));
  const fee = await signedSolanaRpc<{ readonly value: number | null }>({
    method: 'getFeeForMessage',
    params: [base64.encode(transaction.serializeMessage()), { commitment: 'confirmed' }],
    rpcUrl: input.rpcUrl,
    signer: input.signer,
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  });
  if (fee.value === null || !Number.isSafeInteger(fee.value) || fee.value < 0) {
    throw new Error('Pacifica deposit network fee could not be verified.');
  }
  const feeLamports = BigInt(fee.value);
  const solBalanceLamports = BigInt(solBalance.value);
  let simulation: PacificaDepositPlan['simulation'] = 'passed';
  if (tokenBalanceBaseUnits < input.amountBaseUnits) simulation = 'insufficient-token';
  else if (solBalanceLamports < feeLamports) simulation = 'insufficient-sol';
  else {
    const preview = await signedSolanaRpc<{ readonly value: { readonly err: unknown } }>({
      method: 'simulateTransaction',
      params: [
        base64.encode(transaction.serialize({ requireAllSignatures: false, verifySignatures: false })),
        { commitment: 'confirmed', encoding: 'base64', replaceRecentBlockhash: false, sigVerify: false },
      ],
      rpcUrl: input.rpcUrl,
      signer: input.signer,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    });
    if (preview.value.err !== null) {
      throw new Error('Pacifica rejected the collateral deposit preview.');
    }
  }

  return {
    amountBaseUnits: input.amountBaseUnits,
    expiresAtMs: Date.now() + PLAN_LIFETIME_MS,
    feeLamports,
    idempotencyKey: Crypto.randomUUID(),
    owner: input.owner,
    providerBalanceBeforeBaseUnits: input.providerBalanceBeforeBaseUnits,
    simulation,
    solBalanceLamports,
    tokenBalanceBaseUnits,
    unsignedTransaction: transaction.serialize({ requireAllSignatures: false, verifySignatures: false }),
  };
}

export async function submitPacificaDeposit(input: {
  readonly plan: PacificaDepositPlan;
  readonly rpcUrl: string;
  readonly signer: GatewayRequestSigner;
  readonly signal?: AbortSignal;
  readonly onSigned?: (signature: string, signedTransactionBase64: string) => Promise<void>;
  readonly onSubmissionRejected?: () => Promise<void>;
}): Promise<SubmittedTransactionResult> {
  if (Date.now() >= input.plan.expiresAtMs || input.plan.simulation !== 'passed') {
    throw new Error('Pacifica deposit preview expired or is not fundable.');
  }
  return signAndSubmitLegacyTransaction({
    idempotencyKey: input.plan.idempotencyKey,
    owner: input.plan.owner,
    refreshBlockhashBeforeSigning: true,
    rpcUrl: input.rpcUrl,
    signer: input.signer,
    unsignedTransaction: input.plan.unsignedTransaction,
    verifyTransaction: (transaction) => assertPacificaDepositUnchanged(input.plan, transaction),
    ...(input.onSigned === undefined ? {} : { onSigned: input.onSigned }),
    ...(input.onSubmissionRejected === undefined
      ? {}
      : { onSubmissionRejected: input.onSubmissionRejected }),
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  });
}

/**
 * Allows the signer boundary to refresh only the expiring blockhash.
 *
 * The Pacifica instruction was constructed and simulated locally from the confirmed amount. Rebuild the
 * reviewed message with the final hash and compare every byte before signing, so freshness cannot alter
 * the program, accounts, amount, fee payer, or instruction order.
 */
function assertPacificaDepositUnchanged(
  plan: PacificaDepositPlan,
  transaction: Transaction,
): void {
  const expected = Transaction.from(plan.unsignedTransaction);
  if (transaction.recentBlockhash === undefined) {
    throw new Error('The Pacifica deposit is missing a current blockhash.');
  }
  expected.recentBlockhash = transaction.recentBlockhash;
  if (!Buffer.from(expected.serializeMessage()).equals(Buffer.from(transaction.serializeMessage()))) {
    throw new Error('The Pacifica deposit no longer matches the reviewed amount.');
  }
}
