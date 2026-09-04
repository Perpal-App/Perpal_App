import * as Crypto from 'expo-crypto';
import { NATIVE_MINT } from '@solana/spl-token';

import type { AppConfig } from '@/config/appConfig';
import type { GatewayRequestSigner } from '@/integrations/api/gatewayClient';
import { recordClientTelemetry } from '@/integrations/observability/clientTelemetry';
import {
  pacificaCollateral,
  type ProviderCollateral,
} from '@/integrations/perps/providerCollateral';
import { PACIFICA_MINIMUM_CREDITED_DEPOSIT_BASE_UNITS } from '@/integrations/perps/pacifica/pacificaDeposit';
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
} from '@/integrations/umbra/privateFundingLeg';
import {
  collateralLeg,
  feeReserveLeg,
  withCollateralLeg,
  withFeeReserveLeg,
} from '@/integrations/umbra/privateFundingRecord';
import { ensurePrivateFundingRegistration } from '@/integrations/umbra/privateFundingRegistration';
import { createPrivateFundingRelayer } from '@/integrations/umbra/privateFundingRelayer';
import {
  assertPrivateFundingPreflight,
  preparePrivateFundingPreflight,
} from '@/integrations/umbra/privateFundingPreflight';
import { creditedUmbraAmount } from '@/integrations/umbra/privateFundingFees';
import { fundPacificaFromPrivateWallet } from '@/integrations/umbra/privateFundingPacifica';
import {
  createUmbraGatewayDependencies,
  type PrivySolanaProvider,
} from '@/integrations/umbra/umbraGateway';
import {
  readPrivateFundingRecord,
  writePrivateFundingRecord,
  type PrivateFundingRecord,
} from '@/integrations/umbra/umbraSecureStorage';
import { prefetchUmbraZkey } from '@/integrations/umbra/zkAssets';

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

  const collateral = pacificaCollateral(input.config.perps.usdcMint);
  if (
    input.collateral.symbol !== collateral.symbol ||
    input.collateral.mint !== collateral.mint ||
    input.collateral.decimals !== collateral.decimals
  ) {
    throw new PrivateFundingError(
      'Pacifica deposits accept USDC only.',
      'amount_invalid',
    );
  }
  if (
    creditedUmbraAmount(input.amountBaseUnits) <
      PACIFICA_MINIMUM_CREDITED_DEPOSIT_BASE_UNITS
  ) {
    throw new PrivateFundingError(
      'Enter enough USDC for Pacifica to receive at least 10 USDC after the Umbra fee.',
      'pacifica_deposit_below_minimum',
    );
  }
  const record: PrivateFundingRecord = {
    version: 2,
    id: Crypto.randomUUID(),
    mainWalletAddress: input.mainWalletAddress,
    tradingWalletAddress: input.tradingWalletAddress,
    provider: 'pacifica',
    destination: 'pacifica',
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
    providerDepositExpiresAtMs: null,
    providerDepositIdempotencyKey: null,
    providerDepositSignature: null,
    providerDepositSignedTransactionBase64: null,
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
    if (fundingClaimsComplete(record)) {
      await completeFundingDestination(record, input, save);
      logFundingCompleted(operationStartedAtMs, record.destination);
      return record;
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
      deferRelayPolling: true,
      dependencies,
      returnAfterDeposit: true,
      relayer,
      state: collateralLeg(record),
      onState: async (state, phase) => {
        await save(withCollateralLeg(record, state, phase));
      },
    });
    const claimAsset = prefetchUmbraZkey(
      input.config.privacy.umbraZkAssetBaseUrl,
      'claimDepositIntoPublicAmount:n1',
    );
    if (
      record.feeFundingScanStartLeafCounts === null &&
      record.scanStartLeafCounts !== null
    ) {
      await save({
        ...record,
        feeFundingScanStartLeafCounts: record.scanStartLeafCounts,
        updatedAtMs: Date.now(),
      });
    }
    await save({ ...record, phase: 'fee-funding', updatedAtMs: Date.now() });
    await runPrivateFundingLeg({
      client,
      config: input.config,
      deferRelayPolling: true,
      dependencies,
      returnAfterDeposit: true,
      relayer,
      state: feeReserveLeg(record),
      onState: async (state) => {
        await save(withFeeReserveLeg(record, state));
      },
    });
    await runPrivateFundingLeg({
      client,
      config: input.config,
      deferRelayPolling: true,
      dependencies,
      relayer,
      state: collateralLeg(record),
      onState: async (state, phase) => {
        await save(withCollateralLeg(record, state, phase));
      },
    });
    await runPrivateFundingLeg({
      client,
      config: input.config,
      deferRelayPolling: true,
      dependencies,
      relayer,
      state: feeReserveLeg(record),
      onState: async (state) => {
        await save(withFeeReserveLeg(record, state));
      },
    });
    await claimAsset;
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
    await completeFundingDestination(record, input, save);
    logFundingCompleted(operationStartedAtMs, record.destination);
    return record;
  } catch (cause) {
    const classifiedCode = classifyPrivateFundingFailure(cause);
    const code = classifiedCode;
    await save({ ...record, errorCode: code, updatedAtMs: Date.now() });
    console.error('[Perpal Umbra deposit]', JSON.stringify({
      durationMs: Math.round(performance.now() - operationStartedAtMs),
      errorCode: code,
      event: 'funding_failed',
      phase: record.phase,
    }));
    recordClientTelemetry({
      durationMs: performance.now() - operationStartedAtMs,
      errorCode: code,
      operation: `funding.private_deposit.${record.destination}`,
      outcome: 'error',
    });
    throw cause instanceof PrivateFundingError
      ? cause
      : new PrivateFundingError(privateFundingUserMessage(code), code);
  }
}

async function completeFundingDestination(
  current: PrivateFundingRecord,
  input: PrivateFundingInput,
  save: (record: PrivateFundingRecord) => Promise<void>,
): Promise<void> {
  if (current.destination === 'private') {
    await save({
      ...current,
      phase: 'complete',
      errorCode: null,
      updatedAtMs: Date.now(),
    });
    return;
  }

  let providerRecord: PrivateFundingRecord = {
    ...current,
    phase: 'provider-depositing',
    errorCode: null,
    updatedAtMs: Date.now(),
  };
  await save(providerRecord);
  const signature = await fundPacificaFromPrivateWallet({
    config: input.config,
    record: providerRecord,
    signer: input.gatewaySigner,
    onCheckpoint: async (checkpoint) => {
      providerRecord = {
        ...providerRecord,
        ...checkpoint,
        phase: 'provider-depositing',
        updatedAtMs: Date.now(),
      };
      await save(providerRecord);
    },
  });
  await save({
    ...providerRecord,
    providerDepositSignature: signature,
    phase: 'complete',
    errorCode: null,
    updatedAtMs: Date.now(),
  });
}

function fundingClaimsComplete(record: PrivateFundingRecord): boolean {
  return record.claimSignature !== null && record.feeFundingSignature !== null;
}

function logFundingCompleted(
  startedAtMs: number,
  destination: PrivateFundingRecord['destination'],
): void {
  const durationMs = Math.round(performance.now() - startedAtMs);
  console.info('[Perpal Umbra deposit]', JSON.stringify({
    durationMs,
    event: 'funding_completed',
  }));
  recordClientTelemetry({
    durationMs,
    operation: `funding.private_deposit.${destination}`,
    outcome: 'ok',
  });
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
