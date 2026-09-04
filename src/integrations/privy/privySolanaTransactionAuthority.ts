import { ed25519 } from '@noble/curves/ed25519.js';
import { base58 } from '@scure/base';
import { PublicKey, Transaction, VersionedTransaction } from '@solana/web3.js';

import type { LegacyTransactionAuthority } from '@/integrations/solana/signedLegacyTransaction';
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
