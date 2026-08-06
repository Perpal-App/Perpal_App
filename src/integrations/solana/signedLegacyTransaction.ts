import { ed25519 } from '@noble/curves/ed25519.js';
import { base58, base64 } from '@scure/base';
import { Buffer } from 'buffer';
import { PublicKey, Transaction } from '@solana/web3.js';

import type { GatewayRequestSigner } from '@/integrations/api/gatewayClient';
import {
  logTradeTiming,
  type TradeTimingContext,
} from '@/integrations/observability/tradeTiming';
import {
  signedSolanaRpc,
  SolanaRpcError,
} from '@/integrations/api/signedSolanaRpc';

const CONFIRMATION_ATTEMPTS = 10;
const CONFIRMATION_INTERVAL_MS = 1_200;

export type SubmittedTransactionResult = {
  readonly signature: string;
  readonly status: 'confirmed' | 'submitted' | 'unknown';
};

export type SubmittedTransactionStatus = 'confirmed' | 'failed' | 'pending';

export async function readSubmittedTransactionStatus(input: {
  readonly rpcUrl: string;
  readonly signer: GatewayRequestSigner;
  readonly signature: string;
  readonly signal?: AbortSignal;
}): Promise<SubmittedTransactionStatus> {
  const result = await signedSolanaRpc<{
    readonly context: { readonly slot: number };
    readonly value: readonly (
      | { readonly err: unknown; readonly confirmationStatus?: string }
      | null
    )[];
  }>({
    method: 'getSignatureStatuses',
    params: [[input.signature], { searchTransactionHistory: true }],
    rpcUrl: input.rpcUrl,
    signer: input.signer,
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  });
  const status = result.value[0];

  if (status?.err !== null && status?.err !== undefined) {
    return 'failed';
  }
  if (
    status?.confirmationStatus === 'confirmed' ||
    status?.confirmationStatus === 'finalized'
  ) {
    return 'confirmed';
  }
  return 'pending';
}

export class TransactionSigningError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'TransactionSigningError';
  }
}

export async function signAndSubmitLegacyTransaction(input: {
  readonly idempotencyKey: string;
  readonly owner: string;
  readonly rpcUrl: string;
  readonly signer: GatewayRequestSigner;
  readonly unsignedTransaction: Uint8Array;
  readonly onSigned?: (signature: string) => Promise<void>;
  readonly signal?: AbortSignal;
  readonly tradeTiming?: TradeTimingContext;
}): Promise<SubmittedTransactionResult> {
  const owner = new PublicKey(input.owner);

  if (!new PublicKey(input.signer.publicKey).equals(owner)) {
    throw new TransactionSigningError(
      'The active trading signer does not match the transaction authority.',
      'signer_mismatch',
    );
  }

  const transaction = Transaction.from(input.unsignedTransaction);

  if (
    !transaction.feePayer?.equals(owner) ||
    transaction.recentBlockhash === undefined ||
    transaction.signatures.some(
      (entry) =>
        entry.signature !== null && entry.signature.some((byte) => byte !== 0),
    )
  ) {
    throw new TransactionSigningError(
      'The unsigned transaction is not safe to sign.',
      'transaction_invalid',
    );
  }

  const blockhash = await signedSolanaRpc<{
    readonly context: { readonly slot: number };
    readonly value: boolean;
  }>({
    method: 'isBlockhashValid',
    params: [transaction.recentBlockhash, { commitment: 'confirmed' }],
    rpcUrl: input.rpcUrl,
    signer: input.signer,
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  });

  if (!blockhash.value) {
    throw new TransactionSigningError(
      'The transaction expired. Prepare it again.',
      'blockhash_expired',
    );
  }

  const message = transaction.serializeMessage();
  const signature = await input.signer.sign(message);

  if (
    signature.length !== 64 ||
    !ed25519.verify(signature, message, input.signer.publicKey)
  ) {
    throw new TransactionSigningError(
      'The trading wallet returned an invalid signature.',
      'signature_invalid',
    );
  }

  transaction.addSignature(owner, Buffer.from(signature));
  const expectedSignature = base58.encode(signature);
  await input.onSigned?.(expectedSignature);
  const submissionStartedAtMs = performance.now();
  if (input.tradeTiming !== undefined) {
    logTradeTiming(
      input.tradeTiming,
      'intent_to_submission',
      input.tradeTiming.intentStartedAtMs,
      'ok',
    );
  }

  try {
    const submittedSignature = await signedSolanaRpc<string>({
      method: 'sendTransaction',
      params: [
        base64.encode(
          transaction.serialize({
            requireAllSignatures: true,
            verifySignatures: true,
          }),
        ),
        {
          encoding: 'base64',
          maxRetries: 0,
          preflightCommitment: 'confirmed',
          skipPreflight: false,
        },
      ],
      rpcUrl: input.rpcUrl,
      signer: input.signer,
      idempotencyKey: input.idempotencyKey,
      timeoutMs: 12_000,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    });

    if (submittedSignature !== expectedSignature) {
      if (input.tradeTiming !== undefined) {
        logTradeTiming(
          input.tradeTiming,
          'submission_to_acknowledgement',
          submissionStartedAtMs,
          'unknown',
        );
      }
      return { signature: expectedSignature, status: 'unknown' };
    }
    if (input.tradeTiming !== undefined) {
      logTradeTiming(
        input.tradeTiming,
        'submission_to_acknowledgement',
        submissionStartedAtMs,
        'ok',
      );
    }
  } catch (cause) {
    if (cause instanceof SolanaRpcError) {
      if (input.tradeTiming !== undefined) {
        logTradeTiming(
          input.tradeTiming,
          'submission_to_acknowledgement',
          submissionStartedAtMs,
          'unknown',
        );
      }
      return { signature: expectedSignature, status: 'unknown' };
    }

    if (input.tradeTiming !== undefined) {
      logTradeTiming(
        input.tradeTiming,
        'submission_to_acknowledgement',
        submissionStartedAtMs,
        'error',
      );
    }

    throw cause;
  }

  return {
    signature: expectedSignature,
    status: await confirmSignature(
      input.rpcUrl,
      input.signer,
      expectedSignature,
      input.signal,
    ),
  };
}

export async function signAndSubmitMultiSignerLegacyTransaction(input: {
  readonly idempotencyKey: string;
  readonly requestSigner: GatewayRequestSigner;
  readonly rpcUrl: string;
  readonly signers: readonly GatewayRequestSigner[];
  readonly unsignedTransaction: Uint8Array;
  readonly onSigned?: (signature: string) => Promise<void>;
}): Promise<SubmittedTransactionResult> {
  const transaction = Transaction.from(input.unsignedTransaction);
  if (transaction.feePayer === undefined || transaction.recentBlockhash === undefined) {
    throw new TransactionSigningError('The multi-signer transaction is invalid.', 'transaction_invalid');
  }
  const signerByAddress = new Map(input.signers.map((signer) => [
    base58.encode(signer.publicKey),
    signer,
  ]));
  const required = transaction.signatures.map((entry) => entry.publicKey.toBase58());
  if (
    required.length !== input.signers.length ||
    required.some((address) => !signerByAddress.has(address)) ||
    transaction.signatures.some((entry) => entry.signature !== null)
  ) {
    throw new TransactionSigningError(
      'The transaction requested an unexpected signer.',
      'signer_mismatch',
    );
  }
  const valid = await signedSolanaRpc<{ readonly value: boolean }>({
    method: 'isBlockhashValid',
    params: [transaction.recentBlockhash, { commitment: 'confirmed' }],
    rpcUrl: input.rpcUrl,
    signer: input.requestSigner,
  });
  if (!valid.value) {
    throw new TransactionSigningError('The transaction expired.', 'blockhash_expired');
  }
  const message = transaction.serializeMessage();
  for (const address of required) {
    const signer = signerByAddress.get(address)!;
    const signature = await signer.sign(message);
    if (signature.length !== 64 || !ed25519.verify(signature, message, signer.publicKey)) {
      throw new TransactionSigningError('A local signature was invalid.', 'signature_invalid');
    }
    transaction.addSignature(new PublicKey(address), Buffer.from(signature));
  }
  const feePayerSignature = transaction.signatures.find((entry) =>
    entry.publicKey.equals(transaction.feePayer!),
  )?.signature;
  if (feePayerSignature === null || feePayerSignature === undefined) {
    throw new TransactionSigningError('The fee-payer signature is missing.', 'signature_invalid');
  }
  const expected = base58.encode(feePayerSignature);
  await input.onSigned?.(expected);
  const submitted = await signedSolanaRpc<string>({
    method: 'sendTransaction',
    params: [
      base64.encode(transaction.serialize({ requireAllSignatures: true, verifySignatures: true })),
      { encoding: 'base64', maxRetries: 0, preflightCommitment: 'confirmed', skipPreflight: false },
    ],
    rpcUrl: input.rpcUrl,
    signer: input.requestSigner,
    idempotencyKey: input.idempotencyKey,
    timeoutMs: 12_000,
  });
  if (submitted !== expected) return { signature: expected, status: 'unknown' };
  return {
    signature: expected,
    status: await confirmSignature(input.rpcUrl, input.requestSigner, expected),
  };
}

async function confirmSignature(
  rpcUrl: string,
  signer: GatewayRequestSigner,
  signature: string,
  signal?: AbortSignal,
): Promise<'confirmed' | 'submitted'> {
  for (let attempt = 0; attempt < CONFIRMATION_ATTEMPTS; attempt += 1) {
    if (signal?.aborted) {
      return 'submitted';
    }

    try {
      const result = await signedSolanaRpc<{
        readonly context: { readonly slot: number };
        readonly value: readonly (
          | {
              readonly err: unknown;
              readonly confirmationStatus?: string;
            }
          | null
        )[];
      }>({
        method: 'getSignatureStatuses',
        params: [[signature], { searchTransactionHistory: true }],
        rpcUrl,
        signer,
        ...(signal === undefined ? {} : { signal }),
      });
      const status = result.value[0];

      if (status?.err !== null && status?.err !== undefined) {
        throw new TransactionSigningError(
          'The transaction failed on-chain.',
          'transaction_failed',
        );
      }

      if (
        status?.confirmationStatus === 'confirmed' ||
        status?.confirmationStatus === 'finalized'
      ) {
        return 'confirmed';
      }
    } catch (cause) {
      if (cause instanceof TransactionSigningError) {
        throw cause;
      }

      return 'submitted';
    }

    await waitForNextStatus(signal);
  }

  return 'submitted';
}

function waitForNextStatus(signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = () => {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      signal?.removeEventListener('abort', finish);
      resolve();
    };

    timer = setTimeout(finish, CONFIRMATION_INTERVAL_MS);
    signal?.addEventListener('abort', finish, { once: true });
  });
}
