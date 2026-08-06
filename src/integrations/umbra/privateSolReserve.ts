import { ed25519 } from '@noble/curves/ed25519.js';
import { base58, base64 } from '@scure/base';
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createSyncNativeInstruction,
  getAssociatedTokenAddressSync,
  NATIVE_MINT,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { PublicKey, SystemProgram, Transaction } from '@solana/web3.js';

import type { GatewayRequestSigner } from '@/integrations/api/gatewayClient';
import { signedSolanaRpc } from '@/integrations/api/signedSolanaRpc';
import {
  confirmUmbraSignature,
  type PrivySolanaProvider,
} from '@/integrations/umbra/umbraGateway';

const MAX_U64 = (1n << 64n) - 1n;

export const WRAPPED_SOL_MINT = NATIVE_MINT.toBase58();

export async function ensureWrappedSolReserve(input: {
  readonly amountLamports: bigint;
  readonly existingSignature: string | null;
  readonly gatewaySigner: GatewayRequestSigner;
  readonly mainWalletAddress: string;
  readonly onSubmitted: (signature: string) => Promise<void>;
  readonly provider: PrivySolanaProvider;
  readonly rpcUrl: string;
}): Promise<void> {
  if (input.existingSignature !== null) {
    await confirmUmbraSignature(
      input.rpcUrl,
      input.gatewaySigner,
      input.existingSignature,
    );
  }

  const owner = new PublicKey(input.mainWalletAddress);
  const tokenAccount = getAssociatedTokenAddressSync(NATIVE_MINT, owner);
  const currentBalance = await readWrappedSolBalance(
    input.rpcUrl,
    input.gatewaySigner,
    tokenAccount,
  );
  const deficit = privateSolReserveDeficit(
    input.amountLamports,
    currentBalance,
  );

  if (deficit <= 0n) {
    return;
  }

  const latest = await signedSolanaRpc<{
    readonly value: {
      readonly blockhash: string;
      readonly lastValidBlockHeight: number;
    };
  }>({
    method: 'getLatestBlockhash',
    params: [{ commitment: 'confirmed' }],
    rpcUrl: input.rpcUrl,
    signer: input.gatewaySigner,
  });
  const transaction = new Transaction({
    feePayer: owner,
    recentBlockhash: latest.value.blockhash,
  }).add(
    createAssociatedTokenAccountIdempotentInstruction(
      owner,
      tokenAccount,
      owner,
      NATIVE_MINT,
    ),
    SystemProgram.transfer({
      fromPubkey: owner,
      lamports: deficit,
      toPubkey: tokenAccount,
    }),
    createSyncNativeInstruction(tokenAccount),
  );
  const message = transaction.serializeMessage();
  const { signedTransaction } = await input.provider.request({
    method: 'signTransaction',
    params: { transaction },
  });
  const signature = signedTransaction.signature;

  if (
    !equalBytes(message, signedTransaction.serializeMessage()) ||
    signature === null ||
    !ed25519.verify(signature, message, owner.toBytes())
  ) {
    throw new Error('Privy returned an invalid wrapped SOL transaction.');
  }

  const encodedSignature = base58.encode(signature);
  const submitted = await signedSolanaRpc<string>({
    idempotencyKey: `umbra_wrap_${encodedSignature}`,
    method: 'sendTransaction',
    params: [
      base64.encode(
        signedTransaction.serialize({
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
    signer: input.gatewaySigner,
    timeoutMs: 15_000,
  });

  if (submitted !== encodedSignature) {
    throw new Error('Solana returned a different wrapped SOL signature.');
  }

  await input.onSubmitted(encodedSignature);
  await confirmUmbraSignature(input.rpcUrl, input.gatewaySigner, encodedSignature);
}

export function privateSolReserveDeficit(
  targetLamports: bigint,
  currentLamports: bigint,
): bigint {
  if (
    targetLamports <= 0n ||
    targetLamports > MAX_U64 ||
    currentLamports < 0n ||
    currentLamports > MAX_U64
  ) {
    throw new Error('The private SOL reserve amount is invalid.');
  }

  return targetLamports > currentLamports
    ? targetLamports - currentLamports
    : 0n;
}

async function readWrappedSolBalance(
  rpcUrl: string,
  signer: GatewayRequestSigner,
  tokenAccount: PublicKey,
): Promise<bigint> {
  const response = await signedSolanaRpc<{
    readonly value: {
      readonly data: readonly [string, 'base64'];
      readonly owner: string;
    } | null;
  }>({
    method: 'getAccountInfo',
    params: [tokenAccount.toBase58(), { commitment: 'confirmed', encoding: 'base64' }],
    rpcUrl,
    signer,
  });

  if (response.value === null) {
    return 0n;
  }

  if (response.value.owner !== TOKEN_PROGRAM_ID.toBase58()) {
    throw new Error('The wrapped SOL account has an unexpected owner.');
  }

  const data = base64.decode(response.value.data[0]);

  if (data.length < 72) {
    throw new Error('The wrapped SOL account data is invalid.');
  }

  let amount = 0n;

  for (let index = 0; index < 8; index += 1) {
    amount |= BigInt(data[64 + index] ?? 0) << BigInt(index * 8);
  }

  return amount;
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}
