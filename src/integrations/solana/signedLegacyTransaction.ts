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
import {
  confirmSignature,
  type SubmittedTransactionResult,
} from '@/integrations/solana/transactionConfirmation';
import { TransactionSigningError } from '@/integrations/solana/transactionSigningError';

// Re-exported from the modules that now own them, so the six files importing these from here are
// unaffected by the split. The confirmation loop moved out because the versioned path had a second copy
// of it that had already drifted, and a loop that decides whether money moved should not exist twice.
export {
  readSubmittedTransactionStatus,
  type SubmittedTransactionResult,
  type SubmittedTransactionStatus,
} from '@/integrations/solana/transactionConfirmation';
export { TransactionSigningError } from '@/integrations/solana/transactionSigningError';

/** Transaction authority is separate from the signer that authenticates gateway RPC calls. */
export type LegacyTransactionAuthority = {
  readonly publicKey: Uint8Array;
  readonly signTransaction: (transaction: Transaction) => Promise<Transaction>;
};

export async function signAndSubmitLegacyTransaction(input: {
  readonly idempotencyKey: string;
  readonly owner: string;
  readonly rpcUrl: string;
  readonly signer: GatewayRequestSigner;
  readonly transactionAuthority?: LegacyTransactionAuthority;
  readonly unsignedTransaction: Uint8Array;
  readonly onSigned?: (
    signature: string,
    signedTransactionBase64: string,
  ) => Promise<void>;
  readonly onSubmissionRejected?: () => Promise<void>;
  readonly signal?: AbortSignal;
  readonly tradeTiming?: TradeTimingContext;
}): Promise<SubmittedTransactionResult> {
  const owner = new PublicKey(input.owner);
  const authority = input.transactionAuthority ?? localAuthority(input.signer);

  if (!new PublicKey(authority.publicKey).equals(owner)) {
    throw new TransactionSigningError(
      'The active wallet does not match the transaction authority.',
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
  const signed = await authority.signTransaction(Transaction.from(input.unsignedTransaction));
  const ownerSignature = signed.signatures.find((entry) => entry.publicKey.equals(owner));
  const signature = ownerSignature?.signature;

  if (
    !Buffer.from(signed.serializeMessage()).equals(Buffer.from(message)) ||
    !signed.feePayer?.equals(owner) ||
    signed.signatures.length !== 1 ||
    signature === null ||
    signature === undefined ||
    signature.length !== 64 ||
    !ed25519.verify(signature, message, authority.publicKey)
  ) {
    throw new TransactionSigningError(
      'The wallet returned an invalid transaction signature.',
      'signature_invalid',
    );
  }

  const expectedSignature = base58.encode(signature);
  const signedTransactionBase64 = base64.encode(
    signed.serialize({ requireAllSignatures: true, verifySignatures: true }),
  );
  await input.onSigned?.(expectedSignature, signedTransactionBase64);
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
        signedTransactionBase64,
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
      if (cause.code.startsWith('rpc_-')) {
        await input.onSubmissionRejected?.();
        throw new TransactionSigningError(
          'Solana rejected the signed transaction before submission.',
          'submission_rejected',
        );
      }
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
    status: await confirmSignature({
      failureMessage: 'The transaction failed on-chain.',
      rpcUrl: input.rpcUrl,
      signature: expectedSignature,
      signer: input.signer,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    }),
  };
}

export async function submitSignedLegacyTransaction(input: {
  readonly expectedSignature: string;
  readonly idempotencyKey: string;
  readonly owner: string;
  readonly rpcUrl: string;
  readonly signedTransactionBase64: string;
  readonly signer: GatewayRequestSigner;
}): Promise<SubmittedTransactionResult> {
  const transaction = Transaction.from(base64.decode(input.signedTransactionBase64));
  const owner = new PublicKey(input.owner);
  const ownerSignature = transaction.signatures.find((entry) => entry.publicKey.equals(owner));

  if (
    !transaction.feePayer?.equals(owner) ||
    transaction.recentBlockhash === undefined ||
    transaction.signatures.length !== 1 ||
    ownerSignature?.signature === null ||
    ownerSignature?.signature === undefined ||
    base58.encode(ownerSignature.signature) !== input.expectedSignature ||
    !ed25519.verify(
      ownerSignature.signature,
      transaction.serializeMessage(),
      owner.toBytes(),
    )
  ) {
    throw new TransactionSigningError(
      'The stored trade preparation transaction is invalid.',
      'signature_invalid',
    );
  }

  const submitted = await signedSolanaRpc<string>({
    method: 'sendTransaction',
    params: [
      input.signedTransactionBase64,
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
  });

  return {
    signature: input.expectedSignature,
    status: submitted === input.expectedSignature
      ? await confirmSignature({
          failureMessage: 'The transaction failed on-chain.',
          rpcUrl: input.rpcUrl,
          signature: input.expectedSignature,
          signer: input.signer,
        })
      : 'unknown',
  };
}

function localAuthority(signer: GatewayRequestSigner): LegacyTransactionAuthority {
  return {
    publicKey: signer.publicKey,
    signTransaction: async (transaction) => {
      const message = transaction.serializeMessage();
      const signature = await signer.sign(message);
      if (signature.length !== 64 || !ed25519.verify(signature, message, signer.publicKey)) {
        throw new TransactionSigningError(
          'The wallet returned an invalid transaction signature.',
          'signature_invalid',
        );
      }
      transaction.addSignature(new PublicKey(signer.publicKey), Buffer.from(signature));
      return transaction;
    },
  };
}

export async function storedLegacyTransactionIsCurrent(input: {
  readonly rpcUrl: string;
  readonly signedTransactionBase64: string;
  readonly signer: GatewayRequestSigner;
}): Promise<boolean> {
  const transaction = Transaction.from(base64.decode(input.signedTransactionBase64));
  if (transaction.recentBlockhash === undefined) return false;
  const result = await signedSolanaRpc<{ readonly value: boolean }>({
    method: 'isBlockhashValid',
    params: [transaction.recentBlockhash, { commitment: 'confirmed' }],
    rpcUrl: input.rpcUrl,
    signer: input.signer,
  });
  return result.value;
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
    status: await confirmSignature({
      failureMessage: 'The transaction failed on-chain.',
      rpcUrl: input.rpcUrl,
      signature: expected,
      signer: input.requestSigner,
    }),
  };
}
