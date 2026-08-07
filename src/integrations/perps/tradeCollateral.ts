import * as Crypto from 'expo-crypto';
import type { GatewayRequestSigner } from '@/integrations/api/gatewayClient';
import {
  prepareFlashFunding,
  submitFlashFunding,
  type FlashFundingPlan,
} from '@/integrations/perps/flash/flashFunding';
import { fetchFlashPortfolio } from '@/integrations/perps/flash/flashPortfolio';
import {
  flashCollateral,
  listTradingCollateralOptions,
  type ProviderCollateral,
} from '@/integrations/perps/providerCollateral';
import {
  collateralShortfall,
  scaledInputForMinimumOutput,
} from '@/integrations/perps/tradeCollateralMath';
import {
  removePendingTradeAction,
  writePendingTradeAction,
  type PendingTradeAction,
} from '@/integrations/perps/tradeActionStorage';
import {
  prepareStablecoinSwap,
  readTokenBalance,
  type StablecoinSwapPlan,
} from '@/integrations/solana/stablecoinSwap';
import {
  signAndSubmitVersionedTransaction,
} from '@/integrations/solana/signedVersionedTransaction';
import type { SubmittedTransactionResult } from '@/integrations/solana/signedLegacyTransaction';

const CONVERSION_LIFETIME_MS = 45_000;
const MAX_CONVERSION_QUOTES = 3;

type CommonInput = {
  readonly flashProgramId: string;
  readonly owner: string;
  readonly rpcUrl: string;
  readonly signal: AbortSignal;
  readonly signer: GatewayRequestSigner;
  readonly swapBuildUrl: string;
  readonly usdtMint: string;
};

export type TradeCollateralStep =
  | {
      readonly kind: 'conversion';
      readonly provider: 'flash';
      readonly input: ProviderCollateral;
      readonly inputAmountBaseUnits: bigint;
      readonly output: ProviderCollateral;
      readonly requiredOutputBaseUnits: bigint;
      readonly sourceBalanceBaseUnits: bigint;
      readonly plan: StablecoinSwapPlan;
      readonly idempotencyKey: string;
      readonly expiresAtMs: number;
    }
  | { readonly kind: 'flash-collateral'; readonly provider: 'flash'; readonly plan: FlashFundingPlan };

export async function prepareFlashTradeCollateral(
  input: CommonInput & {
    readonly portfolioRpcUrl: string;
    readonly requiredBaseUnits: bigint;
  },
): Promise<TradeCollateralStep | null> {
  const collateral = flashCollateral(input.flashProgramId);
  const portfolio = await fetchFlashPortfolio(
    input.portfolioRpcUrl,
    input.flashProgramId,
    input.owner,
    input.signal,
  );
  const missing = collateralShortfall(
    input.requiredBaseUnits,
    portfolio.deposits.USDC?.baseUnits ?? 0n,
  );
  if (missing === 0n) return null;

  const conversion = await prepareConversionIfNeeded(input, missing);
  if (conversion !== null) return conversion;

  return {
    kind: 'flash-collateral',
    provider: 'flash',
    plan: await prepareFlashFunding({
      amountBaseUnits: missing,
      mint: collateral.mint,
      owner: input.owner,
      programId: input.flashProgramId,
      rpcUrl: input.rpcUrl,
      signer: input.signer,
      signal: input.signal,
    }),
  };
}

export async function submitTradeCollateralStep(input: {
  readonly flashProgramId: string;
  readonly owner: string;
  readonly programId: string;
  readonly rpcUrl: string;
  readonly signal: AbortSignal;
  readonly signer: GatewayRequestSigner;
  readonly step: TradeCollateralStep;
}): Promise<SubmittedTransactionResult> {
  if (Date.now() >= stepExpiry(input.step)) {
    throw new Error('Trade preparation expired. Prepare it again.');
  }
  const checkpoint = (
    signature: string,
    signedTransactionBase64: string | null = null,
  ) => writePendingTradeAction(pendingRecord(input, signature, signedTransactionBase64));

  let result: SubmittedTransactionResult;
  if (input.step.kind === 'conversion') {
    result = await signAndSubmitVersionedTransaction({
      idempotencyKey: input.step.idempotencyKey,
      owner: input.owner,
      rpcUrl: input.rpcUrl,
      signer: input.signer,
      transaction: input.step.plan.transaction,
      onSigned: checkpoint,
    });
  } else {
    result = await submitFlashFunding({
      amountBaseUnits: input.step.plan.amountBaseUnits,
      mint: input.step.plan.mint,
      owner: input.owner,
      plan: input.step.plan,
      programId: input.programId,
      rpcUrl: input.rpcUrl,
      signer: input.signer,
      signal: input.signal,
      onSigned: checkpoint,
    });
  }

  if (result.status === 'confirmed') {
    await removePendingTradeAction(input.owner, input.step.provider);
  }
  return result;
}

function stepExpiry(step: TradeCollateralStep): number {
  return step.kind === 'conversion' ? step.expiresAtMs : step.plan.expiresAtMs;
}

export function tradeCollateralStepCanSubmit(step: TradeCollateralStep): boolean {
  if (step.kind === 'conversion') return step.sourceBalanceBaseUnits >= step.inputAmountBaseUnits;
  return step.plan.simulation === 'passed';
}

async function prepareConversionIfNeeded(
  input: CommonInput,
  requiredOutputBaseUnits: bigint,
): Promise<Extract<TradeCollateralStep, { readonly kind: 'conversion' }> | null> {
  const output = flashCollateral(input.flashProgramId);
  const outputBalance = await readTokenBalance({
    mint: output.mint,
    owner: input.owner,
    rpcUrl: input.rpcUrl,
    signer: input.signer,
    signal: input.signal,
  });
  const outputMissing = collateralShortfall(requiredOutputBaseUnits, outputBalance);
  if (outputMissing === 0n) return null;

  const source = listTradingCollateralOptions(
    input.flashProgramId,
    input.usdtMint,
  ).find((collateral) => collateral.symbol === 'USDT');
  if (source === undefined) {
    throw new Error('USDT collateral configuration is unavailable.');
  }
  const sourceBalance = await readTokenBalance({
    mint: source.mint,
    owner: input.owner,
    rpcUrl: input.rpcUrl,
    signer: input.signer,
    signal: input.signal,
  });
  let amount = outputMissing;
  let plan: StablecoinSwapPlan | null = null;

  for (let quote = 0; quote < MAX_CONVERSION_QUOTES; quote += 1) {
    if (amount > sourceBalance) break;
    plan = await prepareStablecoinSwap({
      amountBaseUnits: amount,
      inputMint: source.mint,
      outputMint: output.mint,
      owner: input.owner,
      rpcUrl: input.rpcUrl,
      signer: input.signer,
      signal: input.signal,
      swapBuildUrl: input.swapBuildUrl,
    });
    if (plan.minimumOutputBaseUnits >= outputMissing) break;
    amount = scaledInputForMinimumOutput(
      amount,
      outputMissing,
      plan.minimumOutputBaseUnits,
    );
    plan = null;
  }

  if (plan === null) {
    throw new Error(`Private wallet T needs more ${source.symbol} for this trade.`);
  }

  return {
    kind: 'conversion',
    provider: 'flash',
    input: source,
    inputAmountBaseUnits: amount,
    output,
    requiredOutputBaseUnits: outputMissing,
    sourceBalanceBaseUnits: sourceBalance,
    plan,
    idempotencyKey: Crypto.randomUUID(),
    expiresAtMs: Date.now() + CONVERSION_LIFETIME_MS,
  };
}

function pendingRecord(
  input: { readonly owner: string; readonly step: TradeCollateralStep },
  signature: string,
  signedTransactionBase64: string | null,
): PendingTradeAction {
  const { step } = input;
  return {
    amountBaseUnits: stepAmount(step).toString(),
    expiresAtMs: step.kind === 'conversion' ? step.expiresAtMs : step.plan.expiresAtMs,
    idempotencyKey: step.kind === 'conversion' ? step.idempotencyKey : step.plan.idempotencyKey,
    kind: step.kind === 'conversion' ? 'conversion' : 'collateral',
    owner: input.owner,
    provider: step.provider,
    signature,
    signedTransactionBase64,
    updatedAtMs: Date.now(),
    version: 1,
  };
}

function stepAmount(step: TradeCollateralStep): bigint {
  if (step.kind === 'conversion') return step.inputAmountBaseUnits;
  return step.plan.amountBaseUnits;
}
