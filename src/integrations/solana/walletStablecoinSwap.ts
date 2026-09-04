import * as Crypto from 'expo-crypto';
import { NATIVE_MINT } from '@solana/spl-token';
import { PublicKey } from '@solana/web3.js';

import type { GatewayRequestSigner } from '@/integrations/api/gatewayClient';
import { signedSolanaRpc } from '@/integrations/api/signedSolanaRpc';
import {
  removePendingTradeAction,
  writePendingTradeAction,
} from '@/integrations/perps/tradeActionStorage';
import {
  assertStablecoinSwapTransactionUnchanged,
  MAX_SWAP_NETWORK_FEE_LAMPORTS,
  prepareStablecoinSwap,
} from '@/integrations/solana/stablecoinSwap';
import {
  readNativeSolBalance,
  readSwapAssetBalance,
  readSwapTokenAccount,
  readTokenAccountRent,
} from '@/integrations/solana/stablecoinSwapBalances';
import {
  StablecoinSwapError,
  type StablecoinSwapPlan,
  type SwapAmountMode,
  type SwapAsset,
  type SwapTokenAccountSnapshot,
} from '@/integrations/solana/stablecoinSwapTypes';
import type { SubmittedTransactionResult } from '@/integrations/solana/signedLegacyTransaction';
import {
  signAndSubmitVersionedTransaction,
  type VersionedTransactionAuthority,
} from '@/integrations/solana/signedVersionedTransaction';

const PLAN_LIFETIME_MS = 45_000;
const MAX_PREPARATION_ATTEMPTS = 4;

export type { SwapAsset } from '@/integrations/solana/stablecoinSwapTypes';
export { swapAssetDecimals } from '@/integrations/solana/stablecoinSwapTypes';
export type WalletSwapScope = 'public' | 'private';

export type WalletStablecoinSwapPlan = {
  readonly amountBaseUnits: bigint;
  readonly amountMode: SwapAmountMode;
  readonly expiresAtMs: number;
  readonly from: SwapAsset;
  readonly idempotencyKey: string;
  readonly owner: string;
  readonly scope: WalletSwapScope;
  readonly sourceBalanceBaseUnits: bigint;
  readonly swap: StablecoinSwapPlan;
  readonly to: SwapAsset;
};

type PreparationInput = {
  readonly from: SwapAsset;
  readonly owner: string;
  readonly requestSigner: GatewayRequestSigner;
  readonly rpcUrl: string;
  readonly scope: WalletSwapScope;
  readonly signal: AbortSignal;
  readonly swapBuildUrl: string;
  readonly usdcMint: string;
};

export async function prepareWalletStablecoinSwap(
  input: PreparationInput & { readonly amountBaseUnits: bigint },
): Promise<WalletStablecoinSwapPlan> {
  if (input.amountBaseUnits <= 0n) {
    throw new StablecoinSwapError(
      'Enter an amount greater than zero.',
      'amount_invalid',
    );
  }
  return prepareAmount(input, input.amountBaseUnits, 'exact');
}

export async function prepareMaximumWalletStablecoinSwap(
  input: PreparationInput,
): Promise<WalletStablecoinSwapPlan> {
  const sourceMint = mintFor(input.from, input.usdcMint);
  const sourceBalance = await readSwapAssetBalance({
    mint: sourceMint,
    owner: input.owner,
    rpcUrl: input.rpcUrl,
    signer: input.requestSigner,
    symbol: input.from,
    signal: input.signal,
  });
  if (sourceBalance <= 0n) throw insufficientSource(input.from);

  if (input.from === 'USDC') {
    return prepareAmount(input, sourceBalance, 'max');
  }

  const tokenAccountRent = await readTokenAccountRent({
    rpcUrl: input.rpcUrl,
    signer: input.requestSigner,
    signal: input.signal,
  });
  const initialReserve =
    MAX_SWAP_NETWORK_FEE_LAMPORTS + tokenAccountRent * 2n;
  if (sourceBalance <= initialReserve) throw insufficientSource('SOL');

  let amount = sourceBalance - initialReserve;
  for (let attempt = 0; attempt < MAX_PREPARATION_ATTEMPTS; attempt += 1) {
    const plan = await prepareAmount(input, amount, 'max');
    const nextAmount =
      plan.swap.solBalanceLamports -
      plan.swap.feeLamports -
      plan.swap.rentLamports;
    if (nextAmount <= 0n) throw insufficientSource('SOL');
    if (nextAmount === amount) return plan;
    amount = nextAmount;
  }

  throw new StablecoinSwapError(
    'The exact maximum changed while fees were being calculated. Try again.',
    'max_unstable',
  );
}

export async function submitWalletStablecoinSwap(input: {
  readonly plan: WalletStablecoinSwapPlan;
  readonly requestSigner: GatewayRequestSigner;
  readonly rpcUrl: string;
  readonly transactionAuthority?: VersionedTransactionAuthority;
}): Promise<SubmittedTransactionResult> {
  const { plan } = input;
  if (Date.now() >= plan.expiresAtMs) {
    throw stalePlan('The swap quote expired. Review a fresh quote.');
  }

  assertStablecoinSwapTransactionUnchanged(plan.swap);
  assertAuthority(plan, input.requestSigner, input.transactionAuthority);
  const [inputAccount, outputAccount, solBalance, blockHeight] = await Promise.all([
    readSwapTokenAccount({
      decimals: plan.swap.inputDecimals,
      mint: plan.swap.inputMint,
      owner: plan.owner,
      rpcUrl: input.rpcUrl,
      signer: input.requestSigner,
    }),
    readSwapTokenAccount({
      decimals: plan.swap.outputDecimals,
      mint: plan.swap.outputMint,
      owner: plan.owner,
      rpcUrl: input.rpcUrl,
      signer: input.requestSigner,
    }),
    readNativeSolBalance({
      owner: plan.owner,
      rpcUrl: input.rpcUrl,
      signer: input.requestSigner,
    }),
    signedSolanaRpc<number>({
      method: 'getBlockHeight',
      params: [{ commitment: 'confirmed' }],
      rpcUrl: input.rpcUrl,
      signer: input.requestSigner,
    }),
  ]);

  if (
    !sameSnapshot(inputAccount, plan.swap.inputTokenAccount) ||
    !sameSnapshot(outputAccount, plan.swap.outputTokenAccount) ||
    solBalance !== plan.swap.solBalanceLamports ||
    !Number.isSafeInteger(blockHeight) ||
    blockHeight < 0 ||
    blockHeight > plan.swap.lastValidBlockHeight
  ) {
    throw stalePlan('Wallet state changed. Review a fresh swap.');
  }
  const currentSource = plan.from === 'SOL'
    ? solBalance
    : inputAccount.amountBaseUnits;
  if (
    currentSource < plan.amountBaseUnits ||
    solBalance < plan.swap.requiredSolLamports
  ) {
    throw insufficientSource(plan.from);
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
    operationLabel: `${plan.scope} wallet token swap`,
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

async function prepareAmount(
  input: PreparationInput,
  amountBaseUnits: bigint,
  amountMode: SwapAmountMode,
): Promise<WalletStablecoinSwapPlan> {
  const to: SwapAsset = input.from === 'USDC' ? 'SOL' : 'USDC';
  const swap = await prepareStablecoinSwap({
    amountBaseUnits,
    inputMint: mintFor(input.from, input.usdcMint),
    inputSymbol: input.from,
    outputMint: mintFor(to, input.usdcMint),
    outputSymbol: to,
    owner: input.owner,
    rpcUrl: input.rpcUrl,
    signal: input.signal,
    signer: input.requestSigner,
    swapBuildUrl: input.swapBuildUrl,
  });
  const sourceBalanceBaseUnits = input.from === 'SOL'
    ? swap.solBalanceLamports
    : swap.inputTokenAccount.amountBaseUnits;
  if (sourceBalanceBaseUnits < amountBaseUnits) {
    throw insufficientSource(input.from);
  }
  return {
    amountBaseUnits,
    amountMode,
    expiresAtMs: Date.now() + PLAN_LIFETIME_MS,
    from: input.from,
    idempotencyKey: Crypto.randomUUID(),
    owner: input.owner,
    scope: input.scope,
    sourceBalanceBaseUnits,
    swap,
    to,
  };
}

function mintFor(asset: SwapAsset, usdcMint: string): string {
  return asset === 'SOL' ? NATIVE_MINT.toBase58() : usdcMint;
}

function sameSnapshot(
  current: SwapTokenAccountSnapshot,
  reviewed: SwapTokenAccountSnapshot,
): boolean {
  return current.address === reviewed.address &&
    current.amountBaseUnits === reviewed.amountBaseUnits &&
    current.exists === reviewed.exists &&
    current.lamports === reviewed.lamports;
}

function assertAuthority(
  plan: WalletStablecoinSwapPlan,
  requestSigner: GatewayRequestSigner,
  authority: VersionedTransactionAuthority | undefined,
): void {
  let requestSignerIsOwner = false;
  let authorityIsOwner = false;
  try {
    const owner = new PublicKey(plan.owner);
    requestSignerIsOwner = new PublicKey(requestSigner.publicKey).equals(owner);
    authorityIsOwner = authority !== undefined &&
      new PublicKey(authority.publicKey).equals(owner);
  } catch {
    throw new StablecoinSwapError(
      'The selected wallet signer is unavailable.',
      'signer_mismatch',
    );
  }
  if (
    (plan.scope === 'private' && (!requestSignerIsOwner || authority !== undefined)) ||
    (plan.scope === 'public' && (requestSignerIsOwner || !authorityIsOwner))
  ) {
    throw new StablecoinSwapError(
      'The selected wallet signer is unavailable.',
      'signer_mismatch',
    );
  }
}

function insufficientSource(asset: SwapAsset): StablecoinSwapError {
  return new StablecoinSwapError(
    `The selected wallet does not have enough ${asset}.`,
    'insufficient_balance',
  );
}

function stalePlan(message: string): StablecoinSwapError {
  return new StablecoinSwapError(message, 'quote_stale');
}
