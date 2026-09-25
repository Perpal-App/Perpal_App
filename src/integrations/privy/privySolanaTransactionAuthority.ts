import { ed25519 } from '@noble/curves/ed25519.js';
import { base58 } from '@scure/base';
import { PublicKey, Transaction, VersionedTransaction } from '@solana/web3.js';

import type { LegacyTransactionAuthority } from '@/integrations/solana/signedLegacyTransaction';
import type { PublicMultiAuthorityLegacySigner } from '@/integrations/solana/signedMultiAuthorityLegacyTransaction';
import type { VersionedTransactionAuthority } from '@/integrations/solana/signedVersionedTransaction';

export type PrivySolanaTransactionProvider = {
  request(input: {
    readonly method: 'signTransaction';
    readonly params: { readonly transaction: VersionedTransaction };
  }): Promise<{ readonly signedTransaction: VersionedTransaction }>;
};

export type PrivySolanaLegacyTransactionProvider = {
  request(input: {
    readonly method: 'signTransaction';
    readonly params: { readonly transaction: Transaction };
  }): Promise<{ readonly signedTransaction: Transaction }>;
};

/**
 * Adapts Privy's embedded public wallet without trusting the returned object.
 * The exact message and the ed25519 signature are checked before it can reach
 * simulation or submission.
 */
export function createPrivyVersionedTransactionAuthority(input: {
  readonly address: string;
  readonly provider: PrivySolanaTransactionProvider;
}): VersionedTransactionAuthority {
  const publicKey = new PublicKey(input.address);
  const publicKeyBytes = publicKey.toBytes();

  return {
    publicKey: publicKeyBytes,
    signTransaction: async (transaction) => {
      const message = transaction.message.serialize();
      const requiredSigners = transaction.message.staticAccountKeys.slice(
        0,
        transaction.message.header.numRequiredSignatures,
      );
      const signerIndex = requiredSigners.findIndex((key) => key.equals(publicKey));

      if (signerIndex < 0) {
        throw new Error('The swap does not require the active public wallet.');
      }

      const { signedTransaction } = await input.provider.request({
        method: 'signTransaction',
        params: { transaction },
      });
      const signature = signedTransaction.signatures[signerIndex];

      if (
        !equalBytes(signedTransaction.message.serialize(), message) ||
        signature === undefined ||
        signature.length !== 64 ||
        !ed25519.verify(signature, message, publicKeyBytes)
      ) {
        throw new Error('Privy returned an invalid public-wallet transaction signature.');
      }

      return signedTransaction;
    },
  };
}

export function createPrivyLegacyTransactionAuthority(input: {
  readonly address: string;
  readonly provider: PrivySolanaLegacyTransactionProvider;
}): LegacyTransactionAuthority {
  const publicKey = new PublicKey(input.address);
  const publicKeyBytes = publicKey.toBytes();

  return {
    publicKey: publicKeyBytes,
    signTransaction: async (transaction) => {
      const message = transaction.serializeMessage();
      if (
        transaction.signatures.length !== 1 ||
        !transaction.signatures[0]?.publicKey.equals(publicKey)
      ) {
        throw new Error('The public-wallet transfer requested an unexpected signer.');
      }

      const { signedTransaction } = await input.provider.request({
        method: 'signTransaction',
        params: { transaction },
      });
      const signature = signedTransaction.signatures.find(
        (entry) => entry.publicKey.equals(publicKey),
      )?.signature;

      if (
        !equalBytes(signedTransaction.serializeMessage(), message) ||
        signedTransaction.signatures.length !== 1 ||
        signature === null ||
        signature === undefined ||
        signature.length !== 64 ||
        !ed25519.verify(signature, message, publicKeyBytes)
      ) {
        throw new Error('Privy returned an invalid public-wallet transaction signature.');
      }

      return signedTransaction;
    },
  };
}

/**
 * Privy M signer for the atomic fast-deposit transaction.
 *
 * Unlike the ordinary legacy adapter, this intentionally accepts exactly two required signer slots:
 * public M first as fee payer, then local T as Pacifica owner. Privy may fill only M. Any message change,
 * extra signer, reordered slot, or attempt to fill T is rejected before the local signer sees it.
 */
export function createPrivyMultiAuthorityLegacySigner(input: {
  readonly address: string;
  readonly coSignerAddress: string;
  readonly provider: PrivySolanaLegacyTransactionProvider;
}): PublicMultiAuthorityLegacySigner {
  const publicKey = new PublicKey(input.address);
  const coSigner = new PublicKey(input.coSignerAddress);
  const publicKeyBytes = publicKey.toBytes();

  return {
    publicKey: publicKeyBytes,
    signTransaction: async (transaction) => {
      const [publicSlot, localSlot] = transaction.signatures;
      const message = transaction.serializeMessage();
      if (
        transaction.signatures.length !== 2 ||
        !transaction.feePayer?.equals(publicKey) ||
        !publicSlot?.publicKey.equals(publicKey) ||
        !localSlot?.publicKey.equals(coSigner) ||
        transaction.signatures.some((entry) => entry.signature !== null)
      ) {
        throw new Error('The fast deposit requested unexpected public-wallet signers.');
      }

      const { signedTransaction } = await input.provider.request({
        method: 'signTransaction',
        params: { transaction },
      });
      const [signedPublic, signedLocal] = signedTransaction.signatures;
      const signature = signedPublic?.signature;
      if (
        !equalBytes(signedTransaction.serializeMessage(), message) ||
        signedTransaction.signatures.length !== 2 ||
        !signedTransaction.feePayer?.equals(publicKey) ||
        !signedPublic?.publicKey.equals(publicKey) ||
        !signedLocal?.publicKey.equals(coSigner) ||
        signedLocal.signature !== null ||
        signature === null ||
        signature === undefined ||
        signature.length !== 64 ||
        !ed25519.verify(signature, message, publicKeyBytes)
      ) {
        throw new Error('Privy returned an invalid fast-deposit signature.');
      }

      return signedTransaction;
    },
  };
}

export function isPrivyWalletAddress(
  expected: string,
  actual: string | null | undefined,
): boolean {
  if (actual === null || actual === undefined) return false;

  try {
    return equalBytes(base58.decode(expected), base58.decode(actual));
  } catch {
    return false;
  }
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every(
    (byte, index) => byte === right[index],
  );
}
