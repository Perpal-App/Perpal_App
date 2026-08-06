import { ed25519 } from '@noble/curves/ed25519.js';
import { address } from '@solana/kit';
import type {
  IUmbraSigner,
  SignedMessage,
  SignableTransaction,
} from '@umbra-privacy/sdk/client';
import type { SignedTransaction } from '@umbra-privacy/sdk/solana';

import type { GatewayRequestSigner } from '@/integrations/api/gatewayClient';

export function createUmbraLocalSigner(
  walletAddress: string,
  signer: GatewayRequestSigner,
): IUmbraSigner {
  const signerAddress = address(walletAddress);
  const publicKey = signer.publicKey;

  const signTransaction = async (
    transaction: SignableTransaction,
  ): Promise<SignedTransaction> => {
    if (!(walletAddress in transaction.signatures)) {
      throw new Error('Umbra transaction does not require private wallet T.');
    }
    const message = Uint8Array.from(transaction.messageBytes);
    const signature = await signer.sign(message);
    assertSignature(message, signature, publicKey);
    return {
      ...transaction,
      signatures: {
        ...transaction.signatures,
        [walletAddress]: signature,
      },
    } as SignedTransaction;
  };

  return {
    address: signerAddress,
    signTransaction,
    signTransactions: async (transactions) => {
      const signed: SignedTransaction[] = [];
      for (const transaction of transactions) {
        signed.push(await signTransaction(transaction));
      }
      return signed;
    },
    signMessage: async (message): Promise<SignedMessage> => {
      const signature = await signer.sign(message);
      assertSignature(message, signature, publicKey);
      return { message, signature, signer: signerAddress } as SignedMessage;
    },
  };
}

function assertSignature(
  message: Uint8Array,
  signature: Uint8Array,
  publicKey: Uint8Array,
): void {
  if (
    signature.length !== 64 ||
    publicKey.length !== 32 ||
    !ed25519.verify(signature, message, publicKey)
  ) {
    throw new Error('Private wallet T returned an invalid Umbra signature.');
  }
}
