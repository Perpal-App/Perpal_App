import type { GatewayRequestSigner } from '@/integrations/api/gatewayClient';
import {
  PACIFICA_MINIMUM_CREDITED_DEPOSIT_BASE_UNITS,
  preparePacificaDeposit,
  submitPacificaDeposit,
  type PacificaDepositPlan,
} from '@/integrations/perps/pacifica/pacificaDeposit';
import { fetchPacificaPortfolio } from '@/integrations/perps/pacifica/pacificaPortfolio';
import { collateralShortfall, creditedDepositAmount } from '@/integrations/perps/tradeCollateralMath';
import {
  removePendingTradeAction,
  writePendingTradeAction,
  type PendingTradeAction,
} from '@/integrations/perps/tradeActionStorage';
import { readTokenBalance } from '@/integrations/solana/stablecoinSwap';
import type { SubmittedTransactionResult } from '@/integrations/solana/signedLegacyTransaction';

export type TradeFundingRequirement = {
  readonly minimumBaseUnits: bigint;
  readonly usdcAvailableBaseUnits: bigint;
};

export class TradeFundingRequirementError extends Error {
  constructor(readonly requirement: TradeFundingRequirement) {
    super('Private USDC is below the required Pacifica deposit.');
    this.name = 'TradeFundingRequirementError';
  }
}

export type TradeCollateralStep = {
  readonly kind: 'pacifica-deposit';
  readonly provider: 'pacifica';
  readonly plan: PacificaDepositPlan;
};

export async function preparePacificaTradeCollateral(input: {
  readonly apiOrigin: string;
  readonly centralState: string;
  readonly owner: string;
  readonly programId: string;
  readonly requiredBaseUnits: bigint;
  readonly rpcUrl: string;
  readonly signal: AbortSignal;
  readonly signer: GatewayRequestSigner;
  readonly usdcMint: string;
  readonly vault: string;
}): Promise<TradeCollateralStep | null> {
  const portfolio = await fetchPacificaPortfolio(
    input.apiOrigin,
    input.owner,
    input.signal,
  );
  const shortfall = collateralShortfall(
    input.requiredBaseUnits,
    usdc(portfolio.availableToSpend),
  );
  if (shortfall === 0n) return null;

  const depositAmount = creditedDepositAmount(
    shortfall,
    PACIFICA_MINIMUM_CREDITED_DEPOSIT_BASE_UNITS,
  );
  const privateUsdc = await readTokenBalance({
    mint: input.usdcMint,
    owner: input.owner,
    rpcUrl: input.rpcUrl,
    signer: input.signer,
    signal: input.signal,
  });
  if (privateUsdc < depositAmount) {
    throw new TradeFundingRequirementError({
      minimumBaseUnits: depositAmount,
      usdcAvailableBaseUnits: privateUsdc,
    });
  }

  return {
    kind: 'pacifica-deposit',
    provider: 'pacifica',
    plan: await preparePacificaDeposit({
      amountBaseUnits: depositAmount,
      centralState: input.centralState,
      mint: input.usdcMint,
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
  if (Date.now() >= input.step.plan.expiresAtMs) {
    throw new Error('Trade preparation expired. Prepare it again.');
  }
  const result = await submitPacificaDeposit({
    plan: input.step.plan,
    rpcUrl: input.rpcUrl,
    signer: input.signer,
    signal: input.signal,
    onSigned: (signature, signedTransactionBase64) => writePendingTradeAction(
      pendingRecord(input.owner, input.step, signature, signedTransactionBase64),
    ),
    onSubmissionRejected: () => removePendingTradeAction(
      input.owner,
      input.step.provider,
    ),
  });
  if (result.status === 'confirmed') {
    await removePendingTradeAction(input.owner, input.step.provider);
  }
  return result;
}

export function tradeCollateralStepCanSubmit(step: TradeCollateralStep): boolean {
  return step.plan.simulation === 'passed';
}

function pendingRecord(
  owner: string,
  step: TradeCollateralStep,
  signature: string,
  signedTransactionBase64: string,
): PendingTradeAction {
  return {
    amountBaseUnits: step.plan.amountBaseUnits.toString(),
    expiresAtMs: step.plan.expiresAtMs,
    idempotencyKey: step.plan.idempotencyKey,
    kind: 'collateral',
    owner,
    provider: step.provider,
    signature,
    signedTransactionBase64,
    updatedAtMs: Date.now(),
    version: 1,
  };
}

function usdc(value: string): bigint {
  if (!/^\d+(?:\.\d{1,6})?$/u.test(value)) {
    throw new Error('Pacifica balance is invalid.');
  }
  const [whole = '0', fraction = ''] = value.split('.');
  return BigInt(`${whole}${fraction.padEnd(6, '0')}`);
}
