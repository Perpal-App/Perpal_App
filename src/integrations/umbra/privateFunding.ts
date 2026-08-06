import * as Crypto from 'expo-crypto';
import { getUmbraRelayer } from '@umbra-privacy/sdk/relayer';

import type { AppConfig, PerpsProviderId } from '@/config/appConfig';
import type { GatewayRequestSigner } from '@/integrations/api/gatewayClient';
import {
  listTradingCollateralOptions,
  type ProviderCollateral,
} from '@/integrations/perps/providerCollateral';
import { fundSelectedProvider } from '@/integrations/perps/providerFunding';
import { ensureProviderCollateral } from '@/integrations/perps/providerCollateralConversion';
import {
  classifyPrivateFundingFailure,
  PrivateFundingError,
  privateFundingUserMessage,
} from '@/integrations/umbra/privateFundingErrors';
import {
  assertRelayerSupportsMint,
  createPrivateFundingClient,
} from '@/integrations/umbra/privateFundingClient';
import {
  runPrivateFundingLeg,
  type PrivateFundingLegPhase,
  type PrivateFundingLegState,
} from '@/integrations/umbra/privateFundingLeg';
import {
  ensureWrappedSolReserve,
  WRAPPED_SOL_MINT,
} from '@/integrations/umbra/privateSolReserve';
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
  readonly provider: PerpsProviderId;
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
    (existing.phase !== 'complete' || existing.providerDepositSignature === null)
  ) {
    throw new PrivateFundingError(
      'Resume the pending private funding operation first.',
      'operation_pending',
    );
  }

  const collateral = listTradingCollateralOptions(
    input.config.perps.flashProgramId,
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
    provider: input.provider,
    mint: collateral.mint,
    symbol: collateral.symbol,
    amountBaseUnits: input.amountBaseUnits.toString(),
    phase: 'depositing',
    generationIndex: null,
    excludedNoteIds: [],
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
    'amountBaseUnits' | 'collateral' | 'feeReserveLamports' | 'provider'
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
      provider: record.provider,
    },
    onRecord,
  );
}

async function runPrivateFunding(
  initialRecord: PrivateFundingRecord,
  input: PrivateFundingInput,
  onRecord: (record: PrivateFundingRecord) => void,
): Promise<PrivateFundingRecord> {
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
    const dependencies = createUmbraGatewayDependencies({
      gatewaySigner: input.gatewaySigner,
      mainWalletAddress: input.mainWalletAddress,
      provider: input.privyProvider,
      rpcUrl: input.config.api.rpcUrl,
    });
    const client = await createPrivateFundingClient({
      config: input.config,
      dependencies,
      mainWalletAddress: input.mainWalletAddress,
    });
    const relayer = getUmbraRelayer({
      apiEndpoint: input.config.privacy.umbraRelayerUrl,
    });
    await Promise.all([
      assertRelayerSupportsMint(relayer, record.mint),
      assertRelayerSupportsMint(relayer, WRAPPED_SOL_MINT),
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
    if (record.feeFundingDepositSignature === null) {
      await ensureWrappedSolReserve({
        amountLamports: input.feeReserveLamports,
        existingSignature: record.feeFundingWrapSignature,
        gatewaySigner: input.gatewaySigner,
        mainWalletAddress: input.mainWalletAddress,
        provider: input.privyProvider,
        rpcUrl: input.config.api.rpcUrl,
        onSubmitted: async (signature) => {
          await save({
            ...record,
            feeFundingWrapSignature: signature,
            updatedAtMs: Date.now(),
          });
        },
      });
    }
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
    record = await ensureProviderCollateral({
      config: input.config,
      onRecord: save,
      record,
      signer: input.gatewaySigner,
    });
    record = await fundSelectedProvider({
      config: input.config,
      record,
      signer: input.gatewaySigner,
      onRecord: save,
    });
    return record;
  } catch (cause) {
    const code = classifyPrivateFundingFailure(cause);
    await save({ ...record, errorCode: code, updatedAtMs: Date.now() });
    throw cause instanceof PrivateFundingError
      ? cause
      : new PrivateFundingError(privateFundingUserMessage(code), code);
  }
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
    mint: WRAPPED_SOL_MINT,
    noteAmountBaseUnits: record.feeFundingNoteAmountLamports,
    populateSignature: record.feeFundingPopulateSignature,
    relayRequestId: record.feeFundingRelayRequestId,
    relayerFixedFeeLamports: record.feeFundingRelayerFixedFeeLamports,
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
