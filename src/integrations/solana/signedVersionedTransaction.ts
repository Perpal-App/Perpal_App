import { ed25519 } from '@noble/curves/ed25519.js';
import { base58, base64 } from '@scure/base';
import { PublicKey, VersionedTransaction } from '@solana/web3.js';

import type { GatewayRequestSigner } from '@/integrations/api/gatewayClient';
import { signedSolanaRpc } from '@/integrations/api/signedSolanaRpc';
import {
  readSubmittedTransactionStatus,
  TransactionSigningError,
  type SubmittedTransactionResult,
} from '@/integrations/solana/signedLegacyTransaction';

const CONFIRMATION_ATTEMPTS = 10;
const CONFIRMATION_INTERVAL_MS = 1_200;

export async function signAndSubmitVersionedTransaction(input: {
  readonly idempotencyKey: string;
  readonly owner: string;
  readonly operationLabel?: string;
  readonly rpcUrl: string;
  readonly signer: GatewayRequestSigner;
  readonly transaction: VersionedTransaction;
  readonly onSigned: (
    signature: string,
    signedTransactionBase64: string,
  ) => Promise<void>;
}): Promise<SubmittedTransactionResult> {
  const operation = input.operationLabel ?? 'stablecoin conversion';
  const owner = new PublicKey(input.owner);
  assertTransactionAuthority(input.transaction, owner, input.signer, true);
  const valid = await isBlockhashValid(
    input.transaction.message.recentBlockhash,
    input.rpcUrl,
    input.signer,
  );

  if (!valid) {
    throw new TransactionSigningError(
      `The ${operation} expired. Prepare it again.`,
      'blockhash_expired',
    );
  }

  const message = input.transaction.message.serialize();
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

  input.transaction.signatures[0] = signature;
  const simulation = await signedSolanaRpc<{
    readonly value: { readonly err: unknown };
  }>({
    method: 'simulateTransaction',
    params: [
      base64.encode(input.transaction.serialize()),
      {
        commitment: 'confirmed',
        encoding: 'base64',
        replaceRecentBlockhash: false,
        sigVerify: true,
      },
    ],
    rpcUrl: input.rpcUrl,
    signer: input.signer,
    timeoutMs: 12_000,
  });

  if (simulation.value.err !== null) {
    throw new TransactionSigningError(
      `The ${operation} preview failed.`,
      'simulation_failed',
    );
  }

  const expectedSignature = base58.encode(signature);
  const signedTransactionBase64 = base64.encode(input.transaction.serialize());
  await input.onSigned(expectedSignature, signedTransactionBase64);
  return submitSignedVersionedTransaction({
    ...input,
    expectedSignature,
    signedTransactionBase64,
  });
}

export async function submitSignedVersionedTransaction(input: {
  readonly expectedSignature: string;
  readonly idempotencyKey: string;
  readonly owner: string;
  readonly operationLabel?: string;
  readonly rpcUrl: string;
  readonly signedTransactionBase64: string;
  readonly signer: GatewayRequestSigner;
}): Promise<SubmittedTransactionResult> {
  const transaction = VersionedTransaction.deserialize(
    base64.decode(input.signedTransactionBase64),
  );
  const owner = new PublicKey(input.owner);
  assertTransactionAuthority(transaction, owner, input.signer, false);
  const signature = transaction.signatures[0];

  if (
    signature === undefined ||
    base58.encode(signature) !== input.expectedSignature ||
    !ed25519.verify(
      signature,
      transaction.message.serialize(),
      input.signer.publicKey,
    )
  ) {
    throw new TransactionSigningError(
      `The stored ${input.operationLabel ?? 'stablecoin conversion'} is invalid.`,
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
    status:
      submitted === input.expectedSignature
        ? await confirm(input)
        : 'unknown',
  };
}

export async function storedVersionedTransactionIsCurrent(input: {
  readonly rpcUrl: string;
  readonly signedTransactionBase64: string;
  readonly signer: GatewayRequestSigner;
}): Promise<boolean> {
  const transaction = VersionedTransaction.deserialize(
    base64.decode(input.signedTransactionBase64),
  );
  return isBlockhashValid(
    transaction.message.recentBlockhash,
    input.rpcUrl,
    input.signer,
  );
}

function assertTransactionAuthority(
  transaction: VersionedTransaction,
  owner: PublicKey,
  signer: GatewayRequestSigner,
  requireUnsigned: boolean,
): void {
  const requiredSigners = transaction.message.header.numRequiredSignatures;
  const feePayer = transaction.message.staticAccountKeys[0];

  if (
    requiredSigners !== 1 ||
    feePayer === undefined ||
    !feePayer.equals(owner) ||
    !new PublicKey(signer.publicKey).equals(owner) ||
    transaction.signatures.length !== 1 ||
    (requireUnsigned &&
      transaction.signatures.some((entry) =>
        entry.some((byte) => byte !== 0),
      ))
  ) {
    throw new TransactionSigningError(
      'The stablecoin conversion requested an unexpected signer.',
      'signer_mismatch',
    );
  }
}

async function isBlockhashValid(
  blockhash: string,
  rpcUrl: string,
  signer: GatewayRequestSigner,
): Promise<boolean> {
  const response = await signedSolanaRpc<{ readonly value: boolean }>({
    method: 'isBlockhashValid',
    params: [blockhash, { commitment: 'confirmed' }],
    rpcUrl,
    signer,
  });
  return response.value;
}

async function confirm(input: {
  readonly expectedSignature: string;
  readonly operationLabel?: string;
  readonly rpcUrl: string;
  readonly signer: GatewayRequestSigner;
}): Promise<'confirmed' | 'submitted'> {
  for (let attempt = 0; attempt < CONFIRMATION_ATTEMPTS; attempt += 1) {
    const status = await readSubmittedTransactionStatus({
      rpcUrl: input.rpcUrl,
      signature: input.expectedSignature,
      signer: input.signer,
    });

    if (status === 'failed') {
      throw new TransactionSigningError(
        `The ${input.operationLabel ?? 'stablecoin conversion'} failed on-chain.`,
        'transaction_failed',
      );
    }
    if (status === 'confirmed') {
      return 'confirmed';
    }
    await new Promise((resolve) => setTimeout(resolve, CONFIRMATION_INTERVAL_MS));
  }

  return 'submitted';
}
