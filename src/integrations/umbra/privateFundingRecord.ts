import { NATIVE_MINT } from '@solana/spl-token';

import type {
  PrivateFundingLegPhase,
  PrivateFundingLegState,
} from '@/integrations/umbra/privateFundingLeg';
import type { PrivateFundingRecord } from '@/integrations/umbra/umbraSecureStorage';

export function collateralLeg(
  record: PrivateFundingRecord,
): PrivateFundingLegState {
  return {
    amountBaseUnits: record.amountBaseUnits,
    claimSignature: record.claimSignature,
    depositSignature: record.depositSignature,
    excludedNoteIds: record.excludedNoteIds,
    generationIndex: record.generationIndex,
    mint: record.mint,
    noteAmountBaseUnits: record.noteAmountBaseUnits,
    populateSignature: record.populateSignature,
    relayRequestId: record.relayRequestId,
    relayerFixedFeeLamports: record.relayerFixedFeeLamports,
    scanStartLeafCounts: record.scanStartLeafCounts,
    tradingWalletAddress: record.tradingWalletAddress,
  };
}

export function feeReserveLeg(
  record: PrivateFundingRecord,
): PrivateFundingLegState {
  return {
    amountBaseUnits: record.feeFundingLamports ?? '0',
    claimSignature: record.feeFundingSignature,
    depositSignature: record.feeFundingDepositSignature,
    excludedNoteIds: record.feeFundingExcludedNoteIds,
    generationIndex: record.feeFundingGenerationIndex,
    mint: NATIVE_MINT.toBase58(),
    noteAmountBaseUnits: record.feeFundingNoteAmountLamports,
    populateSignature: record.feeFundingPopulateSignature,
    relayRequestId: record.feeFundingRelayRequestId,
    relayerFixedFeeLamports: record.feeFundingRelayerFixedFeeLamports,
    scanStartLeafCounts: record.feeFundingScanStartLeafCounts,
    tradingWalletAddress: record.tradingWalletAddress,
  };
}

export function withCollateralLeg(
  record: PrivateFundingRecord,
  state: PrivateFundingLegState,
  phase: PrivateFundingLegPhase,
): PrivateFundingRecord {
  return {
    ...record,
    phase,
    generationIndex: state.generationIndex,
    excludedNoteIds: state.excludedNoteIds,
    scanStartLeafCounts: state.scanStartLeafCounts,
    populateSignature: state.populateSignature,
    depositSignature: state.depositSignature,
    relayRequestId: state.relayRequestId,
    claimSignature: state.claimSignature,
    noteAmountBaseUnits: state.noteAmountBaseUnits,
    relayerFixedFeeLamports: state.relayerFixedFeeLamports,
    updatedAtMs: Date.now(),
  };
}

export function withFeeReserveLeg(
  record: PrivateFundingRecord,
  state: PrivateFundingLegState,
): PrivateFundingRecord {
  return {
    ...record,
    phase: 'fee-funding',
    feeFundingGenerationIndex: state.generationIndex,
    feeFundingExcludedNoteIds: state.excludedNoteIds,
    feeFundingScanStartLeafCounts: state.scanStartLeafCounts,
    feeFundingPopulateSignature: state.populateSignature,
    feeFundingDepositSignature: state.depositSignature,
    feeFundingRelayRequestId: state.relayRequestId,
    feeFundingSignature: state.claimSignature,
    feeFundingNoteAmountLamports: state.noteAmountBaseUnits,
    feeFundingRelayerFixedFeeLamports: state.relayerFixedFeeLamports,
    updatedAtMs: Date.now(),
  };
}
