import * as Crypto from 'expo-crypto';

import type { GatewayRequestSigner } from '@/integrations/api/gatewayClient';
import {
  PACIFICA_MINIMUM_CREDITED_DEPOSIT_BASE_UNITS,
  preparePacificaDeposit,
  submitPacificaDeposit,
  type PacificaDepositPlan,
} from '@/integrations/perps/pacifica/pacificaDeposit';
import { fetchPacificaPortfolio } from '@/integrations/perps/pacifica/pacificaPortfolio';
import {
  listTradingCollateralOptions,
  pacificaCollateral,
  type ProviderCollateral,
} from '@/integrations/perps/providerCollateral';
import {
  collateralShortfall,
  creditedDepositAmount,
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
import { signAndSubmitVersionedTransaction } from '@/integrations/solana/signedVersionedTransaction';
import type { SubmittedTransactionResult } from '@/integrations/solana/signedLegacyTransaction';

const CONVERSION_LIFETIME_MS = 45_000;
const MAX_CONVERSION_QUOTES = 3;

export type TradeFundingRequirement = {
  readonly minimumBaseUnits: bigint;
  readonly usdcAvailableBaseUnits: bigint;
  readonly usdtAvailableBaseUnits: bigint;
};

export class TradeFundingRequirementError extends Error {
  constructor(readonly requirement: TradeFundingRequirement) {
    super('Private funds are below Pacifica funding minimum.');
    this.name = 'TradeFundingRequirementError';
  }
}

type CommonInput = {
  readonly apiOrigin: string;
  readonly centralState: string;
  readonly owner: string;
  readonly programId: string;
  readonly rpcUrl: string;
  readonly signal: AbortSignal;
  readonly signer: GatewayRequestSigner;
  readonly swapBuildUrl: string;
  readonly usdcMint: string;
  readonly usdtMint: string;
  readonly vault: string;
};

export type TradeCollateralStep =
  | {
      readonly kind: 'conversion';
      readonly provider: 'pacifica';
      readonly input: ProviderCollateral;
      readonly inputAmountBaseUnits: bigint;
      readonly output: ProviderCollateral;
      readonly sourceBalanceBaseUnits: bigint;
      readonly plan: StablecoinSwapPlan;
      readonly idempotencyKey: string;
      readonly expiresAtMs: number;
    }
  | {
      readonly kind: 'pacifica-deposit';
      readonly provider: 'pacifica';
      readonly plan: PacificaDepositPlan;
    };

export async function preparePacificaTradeCollateral(
  input: CommonInput & { readonly requiredBaseUnits: bigint },
): Promise<TradeCollateralStep | null> {
  const collateral = pacificaCollateral(input.usdcMint);
  const portfolio = await fetchPacificaPortfolio(input.apiOrigin, input.owner, input.signal);
  const available = usdc(portfolio.availableToSpend);
  const shortfall = collateralShortfall(input.requiredBaseUnits, available);
  if (shortfall === 0n) return null;
  const depositAmount = creditedDepositAmount(
    shortfall,
    PACIFICA_MINIMUM_CREDITED_DEPOSIT_BASE_UNITS,
  );
  const conversion = await prepareConversionIfNeeded(input, depositAmount);
  if (conversion !== null) return conversion;
  return {
    kind: 'pacifica-deposit',
    provider: 'pacifica',
    plan: await preparePacificaDeposit({
      amountBaseUnits: depositAmount,
      centralState: input.centralState,
      mint: collateral.mint,
      owner: input.owner,
      programId: input.programId,
      rpcUrl: input.rpcUrl,
      signer: input.signer,
      signal: input.signal,
      vault: input.vault,
    }),
  };
}

export async function submitTradeCollateralStep(input: {
  readonly owner: string;
  readonly rpcUrl: string;
  readonly signal: AbortSignal;
  readonly signer: GatewayRequestSigner;
  readonly step: TradeCollateralStep;
}): Promise<SubmittedTransactionResult> {
  if (Date.now() >= stepExpiry(input.step)) throw new Error('Trade preparation expired. Prepare it again.');
  const checkpoint = (signature: string, signedTransactionBase64: string | null = null) =>
    writePendingTradeAction(pendingRecord(input.owner, input.step, signature, signedTransactionBase64));
  const result = input.step.kind === 'conversion'
    ? await signAndSubmitVersionedTransaction({
        idempotencyKey: input.step.idempotencyKey,
        owner: input.owner,
        rpcUrl: input.rpcUrl,
        signer: input.signer,
        transaction: input.step.plan.transaction,
        onSigned: checkpoint,
      })
    : await submitPacificaDeposit({
        plan: input.step.plan,
        rpcUrl: input.rpcUrl,
        signer: input.signer,
        signal: input.signal,
        onSigned: checkpoint,
      });
  if (result.status === 'confirmed') await removePendingTradeAction(input.owner, input.step.provider);
  return result;
}

export function tradeCollateralStepCanSubmit(step: TradeCollateralStep): boolean {
  if (step.kind === 'conversion') return step.sourceBalanceBaseUnits >= step.inputAmountBaseUnits;
  return step.plan.simulation === 'passed';
}

async function prepareConversionIfNeeded(
  input: CommonInput,
  requiredOutputBaseUnits: bigint,
): Promise<Extract<TradeCollateralStep, { readonly kind: 'conversion' }> | null> {
  const output = pacificaCollateral(input.usdcMint);
  const outputBalance = await readTokenBalance({
    mint: output.mint,
    owner: input.owner,
    rpcUrl: input.rpcUrl,
    signer: input.signer,
    signal: input.signal,
  });
  const outputMissing = collateralShortfall(requiredOutputBaseUnits, outputBalance);
  if (outputMissing === 0n) return null;
  const source = listTradingCollateralOptions(input.usdcMint, input.usdtMint)
    .find((token) => token.symbol === 'USDT');
  if (source === undefined) throw new Error('USDT collateral configuration is unavailable.');
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
    amount = scaledInputForMinimumOutput(amount, outputMissing, plan.minimumOutputBaseUnits);
    plan = null;
  }
  if (plan === null) {
    throw new TradeFundingRequirementError({
      minimumBaseUnits: requiredOutputBaseUnits,
      usdcAvailableBaseUnits: outputBalance,
      usdtAvailableBaseUnits: sourceBalance,
    });
  }
  return {
    kind: 'conversion',
    provider: 'pacifica',
    input: source,
    inputAmountBaseUnits: amount,
    output,
    sourceBalanceBaseUnits: sourceBalance,
    plan,
    idempotencyKey: Crypto.randomUUID(),
    expiresAtMs: Date.now() + CONVERSION_LIFETIME_MS,
  };
}

function pendingRecord(
  owner: string,
  step: TradeCollateralStep,
  signature: string,
  signedTransactionBase64: string | null,
): PendingTradeAction {
  return {
    amountBaseUnits: stepAmount(step).toString(),
    expiresAtMs: stepExpiry(step),
    idempotencyKey: step.kind === 'conversion' ? step.idempotencyKey : step.plan.idempotencyKey,
    kind: step.kind === 'conversion' ? 'conversion' : 'collateral',
    owner,
    provider: step.provider,
    signature,
    signedTransactionBase64,
    updatedAtMs: Date.now(),
    version: 1,
  };
}

function stepExpiry(step: TradeCollateralStep): number {
  return step.kind === 'conversion' ? step.expiresAtMs : step.plan.expiresAtMs;
}
function stepAmount(step: TradeCollateralStep): bigint {
  return step.kind === 'conversion' ? step.inputAmountBaseUnits : step.plan.amountBaseUnits;
}
function usdc(value: string): bigint {
  if (!/^\d+(?:\.\d{1,6})?$/u.test(value)) throw new Error('Pacifica balance is invalid.');
  const [whole = '0', fraction = ''] = value.split('.');
  return BigInt(`${whole}${fraction.padEnd(6, '0')}`);
}
