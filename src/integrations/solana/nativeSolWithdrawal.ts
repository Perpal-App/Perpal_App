import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { base64 } from '@scure/base';
import { PublicKey, SystemProgram, Transaction } from '@solana/web3.js';

import type { GatewayRequestSigner } from '@/integrations/api/gatewayClient';
import { signedSolanaRpc } from '@/integrations/api/signedSolanaRpc';
import {
  readSubmittedTransactionStatus,
  signAndSubmitLegacyTransaction,
  submitSignedLegacyTransaction,
  type SubmittedTransactionResult,
} from '@/integrations/solana/signedLegacyTransaction';

export type NativeSolWithdrawalResult = SubmittedTransactionResult & {
  readonly feeLamports: bigint;
  readonly reserveLamports: bigint;
};

type PendingNativeSolWithdrawal = {
  readonly amountLamports: string;
  readonly destinationAddress: string;
  readonly feeLamports: string;
  readonly idempotencyKey: string;
  readonly owner: string;
  readonly reserveLamports: string;
  readonly signature: string;
  readonly signedTransactionBase64: string;
};

const PENDING_PREFIX = 'perpal.native-sol-withdrawal.v1.';

export async function withdrawNativeSol(input: {
  readonly amountLamports: bigint;
  readonly destinationAddress: string;
  readonly owner: string;
  readonly rpcUrl: string;
  readonly signer: GatewayRequestSigner;
}): Promise<NativeSolWithdrawalResult> {
  if (input.amountLamports <= 0n || input.destinationAddress === input.owner) {
    throw new Error('Enter a valid SOL amount and a different destination wallet.');
  }

  const pending = await readPending(input.owner);
  if (pending !== null) {
    return resumePending(pending, input);
  }

  const owner = new PublicKey(input.owner);
  const destination = new PublicKey(input.destinationAddress);
  const [balance, latest] = await Promise.all([
    signedSolanaRpc<{ readonly value: number }>({
      method: 'getBalance',
      params: [input.owner, { commitment: 'confirmed' }],
      rpcUrl: input.rpcUrl,
      signer: input.signer,
    }),
    signedSolanaRpc<{
      readonly value: { readonly blockhash: string; readonly lastValidBlockHeight: number };
    }>({
      method: 'getLatestBlockhash',
      params: [{ commitment: 'confirmed' }],
      rpcUrl: input.rpcUrl,
      signer: input.signer,
    }),
  ]);
  if (!Number.isSafeInteger(balance.value) || balance.value < 0) {
    throw new Error('The private SOL balance could not be verified.');
  }

  const transaction = new Transaction({
    feePayer: owner,
    recentBlockhash: latest.value.blockhash,
  }).add(SystemProgram.transfer({
    fromPubkey: owner,
    lamports: input.amountLamports,
    toPubkey: destination,
  }));
  const fee = await signedSolanaRpc<{ readonly value: number | null }>({
    method: 'getFeeForMessage',
    params: [base64.encode(transaction.serializeMessage()), { commitment: 'confirmed' }],
    rpcUrl: input.rpcUrl,
    signer: input.signer,
  });
  if (fee.value === null || !Number.isSafeInteger(fee.value) || fee.value <= 0) {
    throw new Error('The SOL withdrawal fee could not be verified.');
  }

  const feeLamports = BigInt(fee.value);
  const reserveLamports = feeLamports;
  const maximum = BigInt(balance.value) - feeLamports - reserveLamports;
  if (input.amountLamports > maximum) {
    throw new Error(
      'The amount would leave T unable to pay its next network fee. Reduce the SOL amount.',
    );
  }

  const simulation = await signedSolanaRpc<{ readonly value: { readonly err: unknown } }>({
    method: 'simulateTransaction',
    params: [
      base64.encode(transaction.serialize({ requireAllSignatures: false, verifySignatures: false })),
      { commitment: 'confirmed', encoding: 'base64', sigVerify: false },
    ],
    rpcUrl: input.rpcUrl,
    signer: input.signer,
  });
  if (simulation.value.err !== null) {
    throw new Error('The SOL withdrawal preview failed. No transaction was signed.');
  }

  const idempotencyKey = Crypto.randomUUID();
  const result = await signAndSubmitLegacyTransaction({
      idempotencyKey,
      owner: input.owner,
      rpcUrl: input.rpcUrl,
      signer: input.signer,
      unsignedTransaction: transaction.serialize({
        requireAllSignatures: false,
        verifySignatures: false,
      }),
      onSigned: async (signature, signedTransactionBase64) => writePending({
        amountLamports: input.amountLamports.toString(),
        destinationAddress: input.destinationAddress,
        feeLamports: feeLamports.toString(),
        idempotencyKey,
        owner: input.owner,
        reserveLamports: reserveLamports.toString(),
        signature,
        signedTransactionBase64,
      }),
    });
  if (result.status === 'confirmed') await clearPending(input.owner);
  return {
    ...result,
    feeLamports,
    reserveLamports,
  };
}

async function resumePending(
  pending: PendingNativeSolWithdrawal,
  input: Pick<Parameters<typeof withdrawNativeSol>[0], 'rpcUrl' | 'signer'>,
): Promise<NativeSolWithdrawalResult> {
  const status = await readSubmittedTransactionStatus({
    rpcUrl: input.rpcUrl,
    signature: pending.signature,
    signer: input.signer,
  });
  if (status === 'failed') {
    await clearPending(pending.owner);
    throw new Error('The previous SOL withdrawal failed and was not retried.');
  }
  const result = status === 'confirmed'
    ? { signature: pending.signature, status: 'confirmed' as const }
    : await submitSignedLegacyTransaction({
      expectedSignature: pending.signature,
      idempotencyKey: pending.idempotencyKey,
      owner: pending.owner,
      rpcUrl: input.rpcUrl,
      signedTransactionBase64: pending.signedTransactionBase64,
      signer: input.signer,
    });
  if (result.status === 'confirmed') await clearPending(pending.owner);
  return {
    ...result,
    feeLamports: BigInt(pending.feeLamports),
    reserveLamports: BigInt(pending.reserveLamports),
  };
}

async function readPending(owner: string): Promise<PendingNativeSolWithdrawal | null> {
  const value = await SecureStore.getItemAsync(await pendingKey(owner));
  if (value === null) return null;
  try {
    const record = JSON.parse(value) as Record<string, unknown>;
    if (
      record.owner !== owner ||
      typeof record.destinationAddress !== 'string' ||
      typeof record.signature !== 'string' ||
      typeof record.signedTransactionBase64 !== 'string' ||
      typeof record.idempotencyKey !== 'string' ||
      !unsigned(record.amountLamports) ||
      !unsigned(record.feeLamports) ||
      !unsigned(record.reserveLamports)
    ) throw new Error('invalid');
    return record as unknown as PendingNativeSolWithdrawal;
  } catch {
    throw new Error('Stored SOL-withdrawal recovery state is invalid.');
  }
}

async function writePending(record: PendingNativeSolWithdrawal): Promise<void> {
  await SecureStore.setItemAsync(await pendingKey(record.owner), JSON.stringify(record));
}

async function clearPending(owner: string): Promise<void> {
  await SecureStore.deleteItemAsync(await pendingKey(owner));
}

async function pendingKey(owner: string): Promise<string> {
  return `${PENDING_PREFIX}${await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    owner,
  )}`;
}

function unsigned(value: unknown): value is string {
  return typeof value === 'string' && /^\d+$/u.test(value);
}
