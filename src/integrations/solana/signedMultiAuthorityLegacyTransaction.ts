import { ed25519 } from '@noble/curves/ed25519.js';
import { base58, base64 } from '@scure/base';
import { Buffer } from 'buffer';
import { PublicKey, Transaction } from '@solana/web3.js';

import type { GatewayRequestSigner } from '@/integrations/api/gatewayClient';
import {
  signedSolanaRpc,
  SolanaRpcError,
} from '@/integrations/api/signedSolanaRpc';
import {
  confirmSignature,
  SEND_TRANSACTION_MAX_RETRIES,
  type SubmittedTransactionResult,
} from '@/integrations/solana/transactionConfirmation';
import { TransactionSigningError } from '@/integrations/solana/transactionSigningError';

export const FAST_DEPOSIT_INSTRUCTION_NAMES = [
  'ata-create',
  'transfer-checked',
  'pacifica-deposit',
] as const;

/** A public-wallet provider that signs one slot of a two-authority legacy transaction. */
export type PublicMultiAuthorityLegacySigner = {
  readonly publicKey: Uint8Array;
  readonly signTransaction: (transaction: Transaction) => Promise<Transaction>;
};

/**
 * Signs one exact message with Privy M and local T, persists it, then broadcasts it.
 *
 * Kept separate from the one-authority signer because its invariants are deliberately different: M is
 * fee payer and public transfer authority, while T owns the Pacifica account. Broadening the existing
 * signer to tolerate an extra slot would weaken every withdrawal that currently requires exactly one.
 */
export async function signAndSubmitMultiAuthorityLegacyTransaction(input: {
  readonly feePayerAddress: string;
  readonly idempotencyKey: string;
  readonly onSigned?: (signature: string, signedTransactionBase64: string) => Promise<void>;
  readonly onSubmissionRejected?: () => Promise<void>;
  readonly publicSigner: PublicMultiAuthorityLegacySigner;
  readonly requestSigner: GatewayRequestSigner;
  readonly rpcUrl: string;
  readonly signal?: AbortSignal;
  readonly tradingOwnerAddress: string;
  readonly unsignedTransaction: Uint8Array;
  readonly verifyTransaction: (transaction: Transaction) => void;
}): Promise<SubmittedTransactionResult> {
  const feePayer = new PublicKey(input.feePayerAddress);
  const tradingOwner = new PublicKey(input.tradingOwnerAddress);
  const publicKey = new PublicKey(input.publicSigner.publicKey);
  const localKey = new PublicKey(input.requestSigner.publicKey);
  const transaction = Transaction.from(input.unsignedTransaction);

  if (!publicKey.equals(feePayer) || !localKey.equals(tradingOwner)) {
    throw new TransactionSigningError('The fast-deposit signers changed.', 'signer_mismatch');
  }
  assertSignerSlots(transaction, feePayer, tradingOwner, false);

  // The review does not have to race a blockhash. Install a fresh one beside the signatures, then let
  // the operation owner reconstruct all three instructions against it before either authority signs.
  const latest = await signedSolanaRpc<{
    readonly value: { readonly blockhash: string };
  }>({
    method: 'getLatestBlockhash',
    params: [{ commitment: 'confirmed' }],
    rpcUrl: input.rpcUrl,
    signer: input.requestSigner,
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  });
  transaction.recentBlockhash = latest.value.blockhash;
  input.verifyTransaction(transaction);

  const unsigned = transaction.serialize({
    requireAllSignatures: false,
    verifySignatures: false,
  });
  const message = transaction.serializeMessage();
  const publicSigned = await input.publicSigner.signTransaction(Transaction.from(unsigned));
  assertSignerSlots(publicSigned, feePayer, tradingOwner, true);
  input.verifyTransaction(publicSigned);
  if (!Buffer.from(publicSigned.serializeMessage()).equals(Buffer.from(message))) {
    throw new TransactionSigningError('The public wallet changed the fast deposit.', 'signature_invalid');
  }

  const publicSignature = signatureFor(publicSigned, feePayer);
  const localBefore = publicSigned.signatures.find((entry) => entry.publicKey.equals(tradingOwner));
  if (
    publicSignature === null ||
    localBefore?.signature !== null ||
    !ed25519.verify(publicSignature, message, input.publicSigner.publicKey)
  ) {
    throw new TransactionSigningError('The public-wallet signature is invalid.', 'signature_invalid');
  }

  const localSignature = await input.requestSigner.sign(message);
  if (
    localSignature.length !== 64 ||
    !ed25519.verify(localSignature, message, input.requestSigner.publicKey)
  ) {
    throw new TransactionSigningError('The trading-wallet signature is invalid.', 'signature_invalid');
  }
  publicSigned.addSignature(tradingOwner, Buffer.from(localSignature));
  assertSignerSlots(publicSigned, feePayer, tradingOwner, true);
  input.verifyTransaction(publicSigned);

  const expectedSignature = base58.encode(publicSignature);
  const signedTransactionBase64 = base64.encode(publicSigned.serialize({
    requireAllSignatures: true,
    verifySignatures: true,
  }));

  // Run preflight on the exact final bytes, with both real signatures and the fresh blockhash. The plan
  // simulation used the same message shape with signature verification disabled; this closes that last
  // difference before persistence/broadcast and makes signed simulation diagnostics visible.
  const preview = await signedSolanaRpc<{ readonly value: { readonly err: unknown } }>({
    method: 'simulateTransaction',
    params: [
      signedTransactionBase64,
      {
        commitment: 'confirmed',
        encoding: 'base64',
        replaceRecentBlockhash: false,
        sigVerify: true,
      },
    ],
    rpcUrl: input.rpcUrl,
    signer: input.requestSigner,
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  });
  if (preview.value.err !== null) {
    throw new TransactionSigningError('Fast deposit final check failed.', 'simulation_failed');
  }

  await input.onSigned?.(expectedSignature, signedTransactionBase64);

  try {
    const submitted = await sendSignedTransaction({
      idempotencyKey: input.idempotencyKey,
      requestSigner: input.requestSigner,
      rpcUrl: input.rpcUrl,
      signedTransactionBase64,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    });
    if (submitted !== expectedSignature) {
      return { signature: expectedSignature, status: 'unknown' };
    }
  } catch (cause) {
    if (cause instanceof SolanaRpcError) {
      if (cause.code.startsWith('rpc_-')) {
        console.error('[Perpal fast deposit submission]', JSON.stringify({
          code: cause.code,
          detail: cause.diagnostic?.detail ?? null,
          event: 'preflight_rejected',
          logs: cause.diagnostic?.logs ?? [],
          message: cause.diagnostic?.message ?? cause.message,
        }));
        await input.onSubmissionRejected?.();
        throw new TransactionSigningError(
          'Solana rejected the fast deposit before submission.',
          'submission_rejected',
        );
      }
      return { signature: expectedSignature, status: 'unknown' };
    }
    throw cause;
  }

  return {
    signature: expectedSignature,
    status: await confirmSignature({
      failureMessage: 'The fast deposit failed on-chain.',
      instructionNames: FAST_DEPOSIT_INSTRUCTION_NAMES,
      operation: 'pacifica_fast_deposit',
      rpcUrl: input.rpcUrl,
      signature: expectedSignature,
      signer: input.requestSigner,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    }),
  };
}

/** Revalidates and rebroadcasts the exact fully signed bytes saved before the first submission. */
export async function submitSignedMultiAuthorityLegacyTransaction(input: {
  readonly expectedSignature: string;
  readonly idempotencyKey: string;
  readonly owner: string;
  readonly requestSigner: GatewayRequestSigner;
  readonly rpcUrl: string;
  readonly signedTransactionBase64: string;
  readonly waitForConfirmation?: boolean;
}): Promise<SubmittedTransactionResult> {
  const transaction = Transaction.from(base64.decode(input.signedTransactionBase64));
  const tradingOwner = new PublicKey(input.owner);
  const feePayer = transaction.feePayer;
  if (feePayer === undefined || !new PublicKey(input.requestSigner.publicKey).equals(tradingOwner)) {
    throw new TransactionSigningError('The stored fast deposit is invalid.', 'signature_invalid');
  }
  assertSignerSlots(transaction, feePayer, tradingOwner, true);

  const message = transaction.serializeMessage();
  const feePayerSignature = signatureFor(transaction, feePayer);
  const ownerSignature = signatureFor(transaction, tradingOwner);
  if (
    feePayerSignature === null ||
    ownerSignature === null ||
    base58.encode(feePayerSignature) !== input.expectedSignature ||
    !ed25519.verify(feePayerSignature, message, feePayer.toBytes()) ||
    !ed25519.verify(ownerSignature, message, tradingOwner.toBytes())
  ) {
    throw new TransactionSigningError('The stored fast-deposit signatures are invalid.', 'signature_invalid');
  }

  const submitted = await sendSignedTransaction({
    idempotencyKey: input.idempotencyKey,
    requestSigner: input.requestSigner,
    rpcUrl: input.rpcUrl,
    signedTransactionBase64: input.signedTransactionBase64,
  });
  return {
    signature: input.expectedSignature,
    status: submitted === input.expectedSignature
      ? input.waitForConfirmation === false
        ? 'submitted'
        : await confirmSignature({
          failureMessage: 'The fast deposit failed on-chain.',
          rpcUrl: input.rpcUrl,
          signature: input.expectedSignature,
          signer: input.requestSigner,
        })
      : 'unknown',
  };
}

function assertSignerSlots(
  transaction: Transaction,
  feePayer: PublicKey,
  tradingOwner: PublicKey,
  allowPublicSignature: boolean,
): void {
  const [first, second] = transaction.signatures;
  if (
    transaction.recentBlockhash === undefined ||
    !transaction.feePayer?.equals(feePayer) ||
    transaction.signatures.length !== 2 ||
    !first?.publicKey.equals(feePayer) ||
    !second?.publicKey.equals(tradingOwner) ||
    (!allowPublicSignature && transaction.signatures.some((entry) => entry.signature !== null))
  ) {
    throw new TransactionSigningError('The fast deposit requested unexpected signers.', 'signer_mismatch');
  }
}

function signatureFor(transaction: Transaction, key: PublicKey): Uint8Array | null {
  const signature = transaction.signatures.find((entry) => entry.publicKey.equals(key))?.signature;
  return signature === undefined ? null : signature;
}

function sendSignedTransaction(input: {
  readonly idempotencyKey: string;
  readonly requestSigner: GatewayRequestSigner;
  readonly rpcUrl: string;
  readonly signedTransactionBase64: string;
  readonly signal?: AbortSignal;
}): Promise<string> {
  return signedSolanaRpc<string>({
    method: 'sendTransaction',
    params: [
      input.signedTransactionBase64,
      {
        encoding: 'base64',
        maxRetries: SEND_TRANSACTION_MAX_RETRIES,
        preflightCommitment: 'confirmed',
        // The exact fully signed bytes were simulated with signature verification immediately before
        // persistence. Repeating provider preflight here added another full RPC simulation before
        // broadcast; send immediately and let the bounded provider retries carry the verified bytes.
        skipPreflight: true,
      },
    ],
    rpcUrl: input.rpcUrl,
    signer: input.requestSigner,
    idempotencyKey: input.idempotencyKey,
    timeoutMs: 12_000,
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  });
}
