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

/**
 * Owns the on-chain transaction signature only. Gateway RPC authentication is
 * deliberately supplied separately so a Privy public wallet can authorize the
 * transaction while the anonymous trading signer authenticates the RPC call.
 */
export type VersionedTransactionAuthority = {
  readonly publicKey: Uint8Array;
  readonly signTransaction: (
    transaction: VersionedTransaction,
  ) => Promise<VersionedTransaction>;
};

export async function signAndSubmitVersionedTransaction(input: {
  readonly idempotencyKey: string;
  readonly owner: string;
  readonly operationLabel?: string;
  readonly rpcUrl: string;
  /** Authenticates gateway build, simulation, submission, and status requests. */
  readonly signer: GatewayRequestSigner;
  /** Defaults to the gateway signer for locally controlled wallet T. */
  readonly transactionAuthority?: VersionedTransactionAuthority;
  readonly transaction: VersionedTransaction;
  readonly onSigned: (
    signature: string,
    signedTransactionBase64: string,
  ) => Promise<void>;
}): Promise<SubmittedTransactionResult> {
  const operation = input.operationLabel ?? 'stablecoin conversion';
  const owner = new PublicKey(input.owner);
  const authority = input.transactionAuthority ?? localAuthority(input.signer);
  assertTransactionAuthority(input.transaction, owner, authority.publicKey, true);
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
  const unsigned = clone(input.transaction);
  const signed = await authority.signTransaction(unsigned);
  const signedMessage = signed.message.serialize();
  const signature = signed.signatures[0];

  if (
    !equalBytes(signedMessage, message) ||
    signed.signatures.length !== 1 ||
    signature === undefined ||
    signature.length !== 64 ||
    !ed25519.verify(signature, message, owner.toBytes())
  ) {
    throw new TransactionSigningError(
      'The wallet returned an invalid transaction signature.',
      'signature_invalid',
    );
  }

  const simulation = await signedSolanaRpc<{
    readonly value: { readonly err: unknown };
  }>({
    method: 'simulateTransaction',
    params: [
      base64.encode(signed.serialize()),
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
  const signedTransactionBase64 = base64.encode(signed.serialize());
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
  assertTransactionAuthority(transaction, owner, owner.toBytes(), false);
  const signature = transaction.signatures[0];

  if (
    signature === undefined ||
    base58.encode(signature) !== input.expectedSignature ||
    !ed25519.verify(
      signature,
      transaction.message.serialize(),
      owner.toBytes(),
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
  authorityPublicKey: Uint8Array,
  requireUnsigned: boolean,
): void {
  const requiredSigners = transaction.message.header.numRequiredSignatures;
  const feePayer = transaction.message.staticAccountKeys[0];

  if (
    requiredSigners !== 1 ||
    feePayer === undefined ||
    !feePayer.equals(owner) ||
    !new PublicKey(authorityPublicKey).equals(owner) ||
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

function localAuthority(
  signer: GatewayRequestSigner,
): VersionedTransactionAuthority {
  return {
    publicKey: signer.publicKey,
    signTransaction: async (transaction) => {
      const signed = clone(transaction);
      const message = signed.message.serialize();
      const signature = await signer.sign(message);

      if (
        signature.length !== 64 ||
        !ed25519.verify(signature, message, signer.publicKey)
      ) {
        throw new TransactionSigningError(
          'The wallet returned an invalid transaction signature.',
          'signature_invalid',
        );
      }

      signed.signatures[0] = signature;
      return signed;
    },
  };
}

function clone(transaction: VersionedTransaction): VersionedTransaction {
  return VersionedTransaction.deserialize(transaction.serialize());
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every(
    (byte, index) => byte === right[index],
  );
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
