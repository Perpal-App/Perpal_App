import * as Crypto from 'expo-crypto';
import { NATIVE_MINT } from '@solana/spl-token';

import type { AppConfig } from '@/config/appConfig';
import type { GatewayRequestSigner } from '@/integrations/api/gatewayClient';
import {
  listTradingCollateralOptions,
  type ProviderCollateral,
} from '@/integrations/perps/providerCollateral';
import {
  classifyPrivateFundingFailure,
  PrivateFundingError,
  privateFundingUserMessage,
} from '@/integrations/umbra/privateFundingErrors';
import {
  assertRelayerSupportsMints,
  createPrivateFundingClient,
} from '@/integrations/umbra/privateFundingClient';
import {
  runPrivateFundingLeg,
  type PrivateFundingLegPhase,
  type PrivateFundingLegState,
} from '@/integrations/umbra/privateFundingLeg';
import { ensurePrivateFundingRegistration } from '@/integrations/umbra/privateFundingRegistration';
import { createPrivateFundingRelayer } from '@/integrations/umbra/privateFundingRelayer';
import {
  assertPrivateFundingPreflight,
  preparePrivateFundingPreflight,
} from '@/integrations/umbra/privateFundingPreflight';
import {
  createUmbraGatewayDependencies,
  type PrivySolanaProvider,
} from '@/integrations/umbra/umbraGateway';
import {
  readPrivateFundingRecord,
  writePrivateFundingRecord,
  type PrivateFundingRecord,
} from '@/integrations/umbra/umbraSecureStorage';

export type PrivateFundingInput = {
  readonly amountBaseUnits: bigint;
  readonly collateral: ProviderCollateral;
  readonly config: AppConfig;
  readonly feeReserveLamports: bigint;
  readonly gatewaySigner: GatewayRequestSigner;
  readonly mainWalletAddress: string;
  readonly privyProvider: PrivySolanaProvider;
  readonly tradingWalletAddress: string;
};

export async function beginPrivateFunding(
  input: PrivateFundingInput,
  onRecord: (record: PrivateFundingRecord) => void,
): Promise<PrivateFundingRecord> {
  if (input.amountBaseUnits <= 0n || input.feeReserveLamports <= 0n) {
    throw new PrivateFundingError(
      'Enter collateral and a SOL fee reserve greater than zero.',
      'amount_invalid',
    );
  }

  const existing = await readPrivateFundingRecord(input.mainWalletAddress);

  if (
    existing !== null &&
    existing.phase !== 'complete'
  ) {
    throw new PrivateFundingError(
      'Resume the pending private funding operation first.',
      'operation_pending',
    );
  }

  const collateral = listTradingCollateralOptions(
    input.config.perps.usdcMint,
    input.config.perps.usdtMint,
  ).find(
    (option) =>
      option.symbol === input.collateral.symbol &&
      option.mint === input.collateral.mint &&
      option.decimals === input.collateral.decimals,
  );

  if (collateral === undefined) {
    throw new PrivateFundingError(
      'The selected collateral is unavailable.',
      'amount_invalid',
    );
  }
  const record: PrivateFundingRecord = {
    version: 1,
    id: Crypto.randomUUID(),
    mainWalletAddress: input.mainWalletAddress,
    tradingWalletAddress: input.tradingWalletAddress,
    provider: 'pacifica',
    mint: collateral.mint,
    symbol: collateral.symbol,
    amountBaseUnits: input.amountBaseUnits.toString(),
    phase: 'depositing',
    generationIndex: null,
    excludedNoteIds: [],
    scanStartLeafCounts: null,
    populateSignature: null,
    depositSignature: null,
    relayRequestId: null,
    claimSignature: null,
    noteAmountBaseUnits: null,
    relayerFixedFeeLamports: null,
    feeFundingLamports: input.feeReserveLamports.toString(),
    feeFundingWrapSignature: null,
    feeFundingGenerationIndex: null,
    feeFundingExcludedNoteIds: [],
    feeFundingScanStartLeafCounts: null,
    feeFundingPopulateSignature: null,
    feeFundingDepositSignature: null,
    feeFundingRelayRequestId: null,
    feeFundingSignature: null,
    feeFundingNoteAmountLamports: null,
    feeFundingRelayerFixedFeeLamports: null,
    conversionExpectedOutBaseUnits: null,
    conversionMinimumOutBaseUnits: null,
    conversionOutputBalanceBeforeBaseUnits: null,
    conversionOutputBaseUnits: null,
    conversionSignature: null,
    conversionSignedTransactionBase64: null,
    providerSetupComplete: false,
    providerSetupSignature: null,
    providerDepositSignature: null,
    errorCode: null,
    updatedAtMs: Date.now(),
  };

  await persist(record, onRecord);
  return runPrivateFunding(record, input, onRecord);
}

export async function resumePrivateFunding(
  initialRecord: PrivateFundingRecord,
  input: Omit<
    PrivateFundingInput,
    'amountBaseUnits' | 'collateral' | 'feeReserveLamports'
  >,
  onRecord: (record: PrivateFundingRecord) => void,
  legacyFeeReserveLamports?: bigint,
): Promise<PrivateFundingRecord> {
  if (
    initialRecord.mainWalletAddress !== input.mainWalletAddress ||
    initialRecord.tradingWalletAddress !== input.tradingWalletAddress
  ) {
    throw new PrivateFundingError(
      'The pending operation belongs to another wallet.',
      'wallet_mismatch',
    );
  }

  let record = initialRecord;

  if (record.feeFundingLamports === null) {
    if (legacyFeeReserveLamports === undefined || legacyFeeReserveLamports <= 0n) {
      throw new PrivateFundingError(
        'Choose the user-funded SOL reserve before resuming.',
        'fee_reserve_required',
      );
    }

    record = {
      ...record,
      feeFundingLamports: legacyFeeReserveLamports.toString(),
      updatedAtMs: Date.now(),
    };
    await persist(record, onRecord);
  }

  if (record.feeFundingLamports === null) {
    throw new PrivateFundingError(
      'Choose the user-funded SOL reserve before resuming.',
      'fee_reserve_required',
    );
  }

  return runPrivateFunding(
    record,
    {
      ...input,
      amountBaseUnits: BigInt(record.amountBaseUnits),
      collateral: {
        decimals: 6,
        mint: record.mint,
        symbol: record.symbol,
      },
      feeReserveLamports: BigInt(record.feeFundingLamports),
    },
    onRecord,
  );
}

async function runPrivateFunding(
  initialRecord: PrivateFundingRecord,
  input: PrivateFundingInput,
  onRecord: (record: PrivateFundingRecord) => void,
): Promise<PrivateFundingRecord> {
  const operationStartedAtMs = performance.now();
  let record: PrivateFundingRecord = {
    ...initialRecord,
    errorCode: null,
    updatedAtMs: Date.now(),
  };
  const save = async (next: PrivateFundingRecord) => {
    record = next;
    await persist(record, onRecord);
  };

  try {
    await save(record);
    if (hasNoSubmittedFundingStage(record)) {
      assertPrivateFundingPreflight(await preparePrivateFundingPreflight({
        amountBaseUnits: BigInt(record.amountBaseUnits),
        collateralLegPending: true,
        feeLegPending: true,
        feeReserveLamports: input.feeReserveLamports,
        mint: record.mint,
        rpcUrl: input.config.api.rpcUrl,
        signer: input.gatewaySigner,
        walletAddress: input.mainWalletAddress,
      }));
    }
    const dependencies = createUmbraGatewayDependencies({
      gatewaySigner: input.gatewaySigner,
      mainWalletAddress: input.mainWalletAddress,
      provider: input.privyProvider,
      rpcUrl: input.config.api.rpcUrl,
    });
    const client = await createPrivateFundingClient({
      config: input.config,
      dependencies,
      gatewaySigner: input.gatewaySigner,
      mainWalletAddress: input.mainWalletAddress,
    });
    await save({ ...record, phase: 'proving', updatedAtMs: Date.now() });
    await ensurePrivateFundingRegistration({
      client,
      config: input.config,
      dependencies,
    });
    await save({ ...record, phase: 'depositing', updatedAtMs: Date.now() });
    const relayer = createPrivateFundingRelayer(
      input.config.privacy.umbraRelayerUrl,
    );
    const supported = await relayer.getSupportedMints();
    assertRelayerSupportsMints(supported.mints, [
      record.mint,
      NATIVE_MINT.toBase58(),
    ]);

    await runPrivateFundingLeg({
      client,
      config: input.config,
      dependencies,
      relayer,
      state: collateralLeg(record),
      onState: async (state, phase) => {
        await save(withCollateralLeg(record, state, phase));
      },
    });
    await save({ ...record, phase: 'fee-funding', updatedAtMs: Date.now() });
    await runPrivateFundingLeg({
      client,
      config: input.config,
      dependencies,
      relayer,
      state: feeReserveLeg(record),
      onState: async (state) => {
        await save(withFeeReserveLeg(record, state));
      },
    });
    await save({
      ...record,
      phase: 'complete',
      errorCode: null,
      updatedAtMs: Date.now(),
    });
    console.info('[Perpal Umbra deposit]', JSON.stringify({
      durationMs: Math.round(performance.now() - operationStartedAtMs),
      event: 'funding_completed',
    }));
    return record;
  } catch (cause) {
    const classifiedCode = classifyPrivateFundingFailure(cause);
    const code = classifiedCode === 'simulation_failed' && record.phase === 'provider-depositing'
      ? `${record.provider}_deposit_simulation_failed`
      : classifiedCode;
    await save({ ...record, errorCode: code, updatedAtMs: Date.now() });
    console.error('[Perpal Umbra deposit]', JSON.stringify({
      durationMs: Math.round(performance.now() - operationStartedAtMs),
      errorCode: code,
      event: 'funding_failed',
      phase: record.phase,
    }));
    throw cause instanceof PrivateFundingError
      ? cause
      : new PrivateFundingError(privateFundingUserMessage(code), code);
  }
}

function hasNoSubmittedFundingStage(record: PrivateFundingRecord): boolean {
  return [
    record.populateSignature,
    record.depositSignature,
    record.relayRequestId,
    record.claimSignature,
    record.feeFundingWrapSignature,
    record.feeFundingPopulateSignature,
    record.feeFundingDepositSignature,
    record.feeFundingRelayRequestId,
    record.feeFundingSignature,
  ].every((value) => value === null);
}

function collateralLeg(record: PrivateFundingRecord): PrivateFundingLegState {
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

function feeReserveLeg(record: PrivateFundingRecord): PrivateFundingLegState {
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

function withCollateralLeg(
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

function withFeeReserveLeg(
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

async function persist(
  record: PrivateFundingRecord,
  onRecord: (record: PrivateFundingRecord) => void,
): Promise<void> {
  await writePrivateFundingRecord(record);
  console.info('[Perpal recovery]', JSON.stringify({
    event: 'checkpoint',
    operation: 'private_funding',
    phase: record.phase,
  }));
  onRecord(record);
}
