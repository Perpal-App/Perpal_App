import { ed25519 } from '@noble/curves/ed25519.js';
import { base58, base64 } from '@scure/base';
import { Buffer } from 'buffer';
import { PublicKey, Transaction } from '@solana/web3.js';

import type { GatewayRequestSigner } from '@/integrations/api/gatewayClient';
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
  readonly signal?: AbortSignal;
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
      return { signature: expectedSignature, status: 'unknown' };
    }
  } catch (cause) {
    if (cause instanceof SolanaRpcError) {
      return { signature: expectedSignature, status: 'unknown' };
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
