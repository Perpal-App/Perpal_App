import * as Crypto from 'expo-crypto';
import { PublicKey } from '@solana/web3.js';

import type { GatewayRequestSigner } from '@/integrations/api/gatewayClient';
import { signedSolanaRpc } from '@/integrations/api/signedSolanaRpc';
import {
  removePendingTradeAction,
  writePendingTradeAction,
} from '@/integrations/perps/tradeActionStorage';
import {
  prepareStablecoinSwap,
  readTokenBalance,
  type StablecoinSwapPlan,
} from '@/integrations/solana/stablecoinSwap';
import type { SubmittedTransactionResult } from '@/integrations/solana/signedLegacyTransaction';
import {
  signAndSubmitVersionedTransaction,
  type VersionedTransactionAuthority,
} from '@/integrations/solana/signedVersionedTransaction';

const PLAN_LIFETIME_MS = 45_000;

export type Stablecoin = 'USDC' | 'USDT';
export type WalletSwapScope = 'public' | 'private';

export type WalletStablecoinSwapPlan = {
  readonly amountBaseUnits: bigint;
  readonly expiresAtMs: number;
  readonly from: Stablecoin;
  readonly idempotencyKey: string;
  readonly owner: string;
  readonly scope: WalletSwapScope;
  readonly sourceBalanceBaseUnits: bigint;
  readonly swap: StablecoinSwapPlan;
  readonly to: Stablecoin;
};

export async function prepareWalletStablecoinSwap(input: {
  readonly amountBaseUnits: bigint;
  readonly from: Stablecoin;
  readonly owner: string;
  readonly requestSigner: GatewayRequestSigner;
  readonly rpcUrl: string;
  readonly scope: WalletSwapScope;
  readonly signal: AbortSignal;
  readonly swapBuildUrl: string;
  readonly usdcMint: string;
  readonly usdtMint: string;
}): Promise<WalletStablecoinSwapPlan> {
  if (input.amountBaseUnits <= 0n) {
    throw new Error('Enter an amount greater than zero.');
  }

  const to: Stablecoin = input.from === 'USDC' ? 'USDT' : 'USDC';
  const inputMint = input.from === 'USDC' ? input.usdcMint : input.usdtMint;
  const outputMint = to === 'USDC' ? input.usdcMint : input.usdtMint;
  const sourceBalanceBaseUnits = await readTokenBalance({
    mint: inputMint,
    owner: input.owner,
    rpcUrl: input.rpcUrl,
    signal: input.signal,
    signer: input.requestSigner,
  });

  if (sourceBalanceBaseUnits < input.amountBaseUnits) {
    throw new Error(`The selected wallet does not have enough ${input.from}.`);
  }

  return {
    amountBaseUnits: input.amountBaseUnits,
    expiresAtMs: Date.now() + PLAN_LIFETIME_MS,
    from: input.from,
    idempotencyKey: Crypto.randomUUID(),
    owner: input.owner,
    scope: input.scope,
    sourceBalanceBaseUnits,
    swap: await prepareStablecoinSwap({
      amountBaseUnits: input.amountBaseUnits,
      inputMint,
      outputMint,
      owner: input.owner,
      rpcUrl: input.rpcUrl,
      signal: input.signal,
      signer: input.requestSigner,
      swapBuildUrl: input.swapBuildUrl,
    }),
    to,
  };
}

export async function submitWalletStablecoinSwap(input: {
  readonly plan: WalletStablecoinSwapPlan;
  readonly requestSigner: GatewayRequestSigner;
  readonly rpcUrl: string;
  readonly transactionAuthority?: VersionedTransactionAuthority;
}): Promise<SubmittedTransactionResult> {
  const { plan } = input;

  if (Date.now() >= plan.expiresAtMs) {
    throw new Error('The swap quote expired. Review a fresh quote.');
  }

  assertAuthority(plan, input.requestSigner, input.transactionAuthority);
  const [sourceBalanceBaseUnits, solBalance] = await Promise.all([
    readTokenBalance({
      mint: plan.swap.inputMint,
      owner: plan.owner,
      rpcUrl: input.rpcUrl,
      signer: input.requestSigner,
    }),
    signedSolanaRpc<{ readonly value: number }>({
      method: 'getBalance',
      params: [plan.owner, { commitment: 'confirmed' }],
      rpcUrl: input.rpcUrl,
      signer: input.requestSigner,
    }),
  ]);

  if (sourceBalanceBaseUnits < plan.amountBaseUnits) {
    throw new Error(`The ${plan.from} balance changed. Review a fresh swap.`);
  }
  if (!Number.isSafeInteger(solBalance.value) || solBalance.value < 0) {
    throw new Error('The wallet SOL balance could not be verified.');
  }
  if (BigInt(solBalance.value) < plan.swap.requiredSolLamports) {
    throw new Error('This wallet needs more SOL for the reviewed fee and token-account rent.');
  }

  const result = await signAndSubmitVersionedTransaction({
    idempotencyKey: plan.idempotencyKey,
    onSigned: (signature, signedTransactionBase64) => writePendingTradeAction({
      amountBaseUnits: plan.amountBaseUnits.toString(),
      expiresAtMs: plan.expiresAtMs,
      idempotencyKey: plan.idempotencyKey,
      kind: 'conversion',
      owner: plan.owner,
      provider: 'wallet',
      signature,
      signedTransactionBase64,
      updatedAtMs: Date.now(),
      version: 1,
    }),
    operationLabel: `${plan.scope} wallet swap`,
    owner: plan.owner,
    rpcUrl: input.rpcUrl,
    signer: input.requestSigner,
    transaction: plan.swap.transaction,
    ...(input.transactionAuthority === undefined
      ? {}
      : { transactionAuthority: input.transactionAuthority }),
  });

  if (result.status === 'confirmed') {
    await removePendingTradeAction(plan.owner, 'wallet');
  }
  return result;
}

function assertAuthority(
  plan: WalletStablecoinSwapPlan,
  requestSigner: GatewayRequestSigner,
  authority: VersionedTransactionAuthority | undefined,
): void {
  const requestSignerIsOwner = new PublicKey(requestSigner.publicKey).equals(
    new PublicKey(plan.owner),
  );
  const authorityIsOwner = authority !== undefined &&
    new PublicKey(authority.publicKey).equals(new PublicKey(plan.owner));

  if (
    (plan.scope === 'private' && (!requestSignerIsOwner || authority !== undefined)) ||
    (plan.scope === 'public' && (requestSignerIsOwner || !authorityIsOwner))
  ) {
    throw new Error('The selected wallet signer is unavailable.');
  }
}
