import * as Crypto from 'expo-crypto';

import type { GatewayRequestSigner } from '@/integrations/api/gatewayClient';
import {
  removePendingTradeAction,
  writePendingTradeAction,
} from '@/integrations/perps/tradeActionStorage';
import {
  prepareStablecoinSwap,
  readTokenBalance,
  type StablecoinSwapPlan,
} from '@/integrations/solana/stablecoinSwap';
import { signedSolanaRpc } from '@/integrations/api/signedSolanaRpc';
import type { SubmittedTransactionResult } from '@/integrations/solana/signedLegacyTransaction';
import { signAndSubmitVersionedTransaction } from '@/integrations/solana/signedVersionedTransaction';

const PLAN_LIFETIME_MS = 45_000;

export type PrivateStablecoin = 'USDC' | 'USDT';

export type PrivateWalletSwapPlan = {
  readonly amountBaseUnits: bigint;
  readonly expiresAtMs: number;
  readonly from: PrivateStablecoin;
  readonly idempotencyKey: string;
  readonly sourceBalanceBaseUnits: bigint;
  readonly swap: StablecoinSwapPlan;
  readonly to: PrivateStablecoin;
};

export async function preparePrivateWalletSwap(input: {
  readonly amountBaseUnits: bigint;
  readonly from: PrivateStablecoin;
  readonly owner: string;
  readonly rpcUrl: string;
  readonly signal: AbortSignal;
  readonly signer: GatewayRequestSigner;
  readonly swapBuildUrl: string;
  readonly usdcMint: string;
  readonly usdtMint: string;
}): Promise<PrivateWalletSwapPlan> {
  if (input.amountBaseUnits <= 0n) {
    throw new Error('Enter an amount greater than zero.');
  }

  const to: PrivateStablecoin = input.from === 'USDC' ? 'USDT' : 'USDC';
  const inputMint = input.from === 'USDC' ? input.usdcMint : input.usdtMint;
  const outputMint = to === 'USDC' ? input.usdcMint : input.usdtMint;
  const sourceBalanceBaseUnits = await readTokenBalance({
    mint: inputMint,
    owner: input.owner,
    rpcUrl: input.rpcUrl,
    signal: input.signal,
    signer: input.signer,
  });

  if (sourceBalanceBaseUnits < input.amountBaseUnits) {
    throw new Error(`Private wallet T does not have enough ${input.from}.`);
  }

  return {
    amountBaseUnits: input.amountBaseUnits,
    expiresAtMs: Date.now() + PLAN_LIFETIME_MS,
    from: input.from,
    idempotencyKey: Crypto.randomUUID(),
    sourceBalanceBaseUnits,
    swap: await prepareStablecoinSwap({
      amountBaseUnits: input.amountBaseUnits,
      inputMint,
      outputMint,
      owner: input.owner,
      rpcUrl: input.rpcUrl,
      signal: input.signal,
      signer: input.signer,
      swapBuildUrl: input.swapBuildUrl,
    }),
    to,
  };
}

export async function submitPrivateWalletSwap(input: {
  readonly owner: string;
  readonly plan: PrivateWalletSwapPlan;
  readonly rpcUrl: string;
  readonly signer: GatewayRequestSigner;
}): Promise<SubmittedTransactionResult> {
  if (Date.now() >= input.plan.expiresAtMs) {
    throw new Error('The swap quote expired. Review a fresh quote.');
  }

  const [sourceBalanceBaseUnits, solBalance] = await Promise.all([
    readTokenBalance({
      mint: input.plan.swap.inputMint,
      owner: input.owner,
      rpcUrl: input.rpcUrl,
      signer: input.signer,
    }),
    signedSolanaRpc<{ readonly value: number }>({
      method: 'getBalance',
      params: [input.owner, { commitment: 'confirmed' }],
      rpcUrl: input.rpcUrl,
      signer: input.signer,
    }),
  ]);
  if (sourceBalanceBaseUnits < input.plan.amountBaseUnits) {
    throw new Error(
      `The ${input.plan.from} balance changed. Review a fresh swap.`,
    );
  }
  if (!Number.isSafeInteger(solBalance.value) || solBalance.value < 0) {
    throw new Error('The private wallet SOL balance could not be verified.');
  }
  if (BigInt(solBalance.value) < input.plan.swap.requiredSolLamports) {
    throw new Error(
      'Private wallet T needs more SOL for the reviewed network fee and token-account rent.',
    );
  }

  const result = await signAndSubmitVersionedTransaction({
    idempotencyKey: input.plan.idempotencyKey,
    onSigned: (signature, signedTransactionBase64) => writePendingTradeAction({
      amountBaseUnits: input.plan.amountBaseUnits.toString(),
      expiresAtMs: input.plan.expiresAtMs,
      idempotencyKey: input.plan.idempotencyKey,
      kind: 'conversion',
      owner: input.owner,
      provider: 'wallet',
      signature,
      signedTransactionBase64,
      updatedAtMs: Date.now(),
      version: 1,
    }),
    operationLabel: 'private wallet swap',
    owner: input.owner,
    rpcUrl: input.rpcUrl,
    signer: input.signer,
    transaction: input.plan.swap.transaction,
  });

  if (result.status === 'confirmed') {
    await removePendingTradeAction(input.owner, 'wallet');
  }
  return result;
}
