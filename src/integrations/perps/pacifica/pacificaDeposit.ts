import { sha256 } from '@noble/hashes/sha2.js';
import { utf8ToBytes } from '@noble/hashes/utils.js';
import { base64 } from '@scure/base';
import { Buffer } from 'buffer';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import {
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';
import * as Crypto from 'expo-crypto';

import type { GatewayRequestSigner } from '@/integrations/api/gatewayClient';
import { signedSolanaRpc } from '@/integrations/api/signedSolanaRpc';
import { readTokenBalance } from '@/integrations/solana/stablecoinSwap';
import {
  signAndSubmitLegacyTransaction,
  type SubmittedTransactionResult,
} from '@/integrations/solana/signedLegacyTransaction';

const PLAN_LIFETIME_MS = 45_000;
const DEPOSIT_DISCRIMINATOR = sha256(utf8ToBytes('global:deposit')).slice(0, 8);

// Pacifica does not expose this as account metadata. Its public protocol docs state that
// smaller deposits are not credited, so the client must not submit them and strand funds.
export const PACIFICA_MINIMUM_CREDITED_DEPOSIT_BASE_UNITS = 10_000_000n;

export type PacificaDepositPlan = {
  readonly amountBaseUnits: bigint;
  readonly expiresAtMs: number;
  readonly feeLamports: bigint;
  readonly idempotencyKey: string;
  readonly owner: string;
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
  readonly rpcUrl: string;
  readonly signer: GatewayRequestSigner;
  readonly signal?: AbortSignal;
  readonly vault: string;
}): Promise<PacificaDepositPlan> {
  if (input.amountBaseUnits <= 0n || input.amountBaseUnits > 0xffff_ffff_ffff_ffffn) {
    throw new Error('Pacifica deposit amount is invalid.');
  }
  const owner = new PublicKey(input.owner);
  const programId = new PublicKey(input.programId);
  if (!owner.equals(new PublicKey(input.signer.publicKey))) {
    throw new Error('Private wallet T does not match the Pacifica deposit signer.');
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
    throw new Error('Private wallet T returned an invalid SOL balance.');
  }

  const transaction = new Transaction({
    feePayer: owner,
    recentBlockhash: blockhash.value.blockhash,
  }).add(depositInstruction(input, owner, programId));
  const fee = await signedSolanaRpc<{ readonly value: number | null }>({
    method: 'getFeeForMessage',
    params: [base64.encode(transaction.serializeMessage()), { commitment: 'confirmed' }],
    rpcUrl: input.rpcUrl,
    signer: input.signer,
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  });
  if (fee.value === null || !Number.isSafeInteger(fee.value) || fee.value < 0) {
    throw new Error('Pacifica deposit fee could not be verified.');
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
}): Promise<SubmittedTransactionResult> {
  if (Date.now() >= input.plan.expiresAtMs || input.plan.simulation !== 'passed') {
    throw new Error('Pacifica deposit preview expired or is not fundable.');
  }
  return signAndSubmitLegacyTransaction({
    idempotencyKey: input.plan.idempotencyKey,
    owner: input.plan.owner,
    rpcUrl: input.rpcUrl,
    signer: input.signer,
    unsignedTransaction: input.plan.unsignedTransaction,
    ...(input.onSigned === undefined ? {} : { onSigned: input.onSigned }),
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  });
}

function depositInstruction(
  input: {
    readonly amountBaseUnits: bigint;
    readonly centralState: string;
    readonly mint: string;
    readonly vault: string;
  },
  owner: PublicKey,
  programId: PublicKey,
): TransactionInstruction {
  const mint = new PublicKey(input.mint);
  const data = Buffer.alloc(16);
  data.set(DEPOSIT_DISCRIMINATOR, 0);
  data.writeBigUInt64LE(input.amountBaseUnits, 8);
  const [eventAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from('__event_authority')],
    programId,
  );
  return new TransactionInstruction({
    programId,
    data,
    keys: [
      { pubkey: owner, isSigner: true, isWritable: true },
      { pubkey: getAssociatedTokenAddressSync(mint, owner), isSigner: false, isWritable: true },
      { pubkey: new PublicKey(input.centralState), isSigner: false, isWritable: true },
      { pubkey: new PublicKey(input.vault), isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: eventAuthority, isSigner: false, isWritable: false },
      { pubkey: programId, isSigner: false, isWritable: false },
    ],
  });
}
