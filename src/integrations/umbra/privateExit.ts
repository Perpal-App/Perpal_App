import * as Crypto from 'expo-crypto';
import { NATIVE_MINT } from '@solana/spl-token';
import { getUmbraRelayer } from '@umbra-privacy/sdk/relayer';

import type { AppConfig } from '@/config/appConfig';
import { amountFromBaseUnits, formatAmount } from '@/domain/money/amount';
import type { GatewayRequestSigner } from '@/integrations/api/gatewayClient';
import { recordClientTelemetry } from '@/integrations/observability/clientTelemetry';
import {
  classifyPrivateFundingFailure,
  PrivateFundingError,
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
import { ensurePrivateFundingRegistration } from '@/integrations/umbra/privateFundingRegistration';
import { preparePrivateFundingPreflight } from '@/integrations/umbra/privateFundingPreflight';
import { createUmbraLocalGatewayDependencies } from '@/integrations/umbra/umbraGateway';
import {
  deletePrivateExitRecord,
  readPrivateExitRecord,
  writePrivateExitRecord,
  type PrivateExitRecord,
} from '@/integrations/umbra/privateExitStorage';

const RESETTABLE_UNSUBMITTED_ERRORS = new Set([
  'insufficient_collateral',
  'insufficient_sol',
  'rpc_-32002',
]);

type Input = {
  readonly amountBaseUnits: bigint;
  readonly config: AppConfig;
  readonly destinationAddress: string;
  readonly gatewaySigner: GatewayRequestSigner;
  readonly mint: string;
  readonly sourceWalletAddress: string;
  readonly symbol: string;
};

export async function beginPrivateExit(
  input: Input,
  onRecord: (record: PrivateExitRecord) => void,
): Promise<PrivateExitRecord> {
  if (input.amountBaseUnits <= 0n) {
    throw new PrivateFundingError('Enter a withdrawal amount greater than zero.', 'amount_invalid');
  }
  if (input.destinationAddress === input.sourceWalletAddress) {
    throw new PrivateFundingError('Choose a wallet other than private wallet T.', 'destination_invalid');
  }
  const existing = await readPrivateExitRecord(input.sourceWalletAddress);
  if (existing !== null && existing.phase !== 'complete') {
    throw new PrivateFundingError('Resume the pending private withdrawal first.', 'operation_pending');
  }
  const record: PrivateExitRecord = {
    version: 1,
    id: Crypto.randomUUID(),
    sourceWalletAddress: input.sourceWalletAddress,
    destinationAddress: input.destinationAddress,
    mint: input.mint,
    symbol: input.symbol,
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
    errorCode: null,
    updatedAtMs: Date.now(),
  };
  await persist(record, onRecord);
  return runExit(record, input, onRecord);
}

export async function resumePrivateExit(
  record: PrivateExitRecord,
  input: Omit<Input, 'amountBaseUnits' | 'destinationAddress' | 'mint' | 'symbol'>,
  onRecord: (record: PrivateExitRecord) => void,
): Promise<PrivateExitRecord> {
  if (record.sourceWalletAddress !== input.sourceWalletAddress) {
    throw new PrivateFundingError('The pending withdrawal belongs to another wallet.', 'wallet_mismatch');
  }
  return runExit(
    record,
    {
      ...input,
      amountBaseUnits: BigInt(record.amountBaseUnits),
      destinationAddress: record.destinationAddress,
      mint: record.mint,
      symbol: record.symbol,
    },
    onRecord,
  );
}

export function canResetPrivateExit(record: PrivateExitRecord): boolean {
  return record.phase !== 'complete' &&
    record.errorCode !== null &&
    RESETTABLE_UNSUBMITTED_ERRORS.has(record.errorCode) &&
    [
      record.populateSignature,
      record.depositSignature,
      record.relayRequestId,
      record.claimSignature,
    ].every((value) => value === null);
}

export async function resetPrivateExit(record: PrivateExitRecord): Promise<void> {
  if (!canResetPrivateExit(record)) {
    throw new PrivateFundingError(
      'This withdrawal may have been submitted and must be resumed instead.',
      'operation_pending',
    );
  }
  await deletePrivateExitRecord(record.sourceWalletAddress);
}

async function runExit(
  initial: PrivateExitRecord,
  input: Input,
  onRecord: (record: PrivateExitRecord) => void,
): Promise<PrivateExitRecord> {
  const startedAtMs = performance.now();
  let record: PrivateExitRecord = {
    ...initial,
    errorCode: null,
    updatedAtMs: Date.now(),
  };
  const save = async (next: PrivateExitRecord) => {
    record = next;
    await persist(record, onRecord);
  };

  try {
    const dependencies = createUmbraLocalGatewayDependencies({
      gatewaySigner: input.gatewaySigner,
      rpcUrl: input.config.api.rpcUrl,
      walletAddress: input.sourceWalletAddress,
    });
    const client = await createPrivateFundingClient({
      config: input.config,
      dependencies,
      gatewaySigner: input.gatewaySigner,
      mainWalletAddress: input.sourceWalletAddress,
    });
    await save({ ...record, phase: 'proving', updatedAtMs: Date.now() });
    await ensurePrivateFundingRegistration({
      client,
      config: input.config,
      dependencies,
    });
    await save({ ...record, phase: 'depositing', updatedAtMs: Date.now() });
    const relayer = getUmbraRelayer({ apiEndpoint: input.config.privacy.umbraRelayerUrl });
    await assertRelayerSupportsMint(relayer, record.mint);
    await runPrivateFundingLeg({
      beforeDeposit: () => assertPrivateExitPreflight(record, input),
      client,
      config: input.config,
      dependencies,
      relayer,
      state: leg(record),
      onState: async (state, phase) => save(withLeg(record, state, phase)),
    });
    await save({ ...record, phase: 'complete', errorCode: null, updatedAtMs: Date.now() });
    recordClientTelemetry({
      durationMs: performance.now() - startedAtMs,
      operation: 'funding.private_withdrawal',
      outcome: 'ok',
    });
    return record;
  } catch (cause) {
    const code = classifyPrivateFundingFailure(cause);
    await save({ ...record, errorCode: code, updatedAtMs: Date.now() });
    recordClientTelemetry({
      durationMs: performance.now() - startedAtMs,
      errorCode: code,
      operation: 'funding.private_withdrawal',
      outcome: 'error',
    });
    throw cause instanceof PrivateFundingError
      ? cause
      : new PrivateFundingError(
        'Private withdrawal did not complete. Progress is saved for a safe retry.',
        code,
      );
  }
}

async function assertPrivateExitPreflight(
  record: PrivateExitRecord,
  input: Input,
): Promise<void> {
  const native = record.mint === NATIVE_MINT.toBase58();
  const preflight = await preparePrivateFundingPreflight({
    amountBaseUnits: native ? 0n : BigInt(record.amountBaseUnits),
    collateralLegPending: !native,
    feeLegPending: native,
    feeReserveLamports: native ? BigInt(record.amountBaseUnits) : 0n,
    mint: record.mint,
    rpcUrl: input.config.api.rpcUrl,
    signer: input.gatewaySigner,
    walletAddress: input.sourceWalletAddress,
  });

  if (preflight.missingCollateralBaseUnits > 0n) {
    throw new PrivateFundingError(
      `Private wallet T does not hold enough ${record.symbol} for this withdrawal.`,
      'insufficient_collateral',
    );
  }
  if (preflight.missingSolLamports > 0n) {
    const available = formatAmount(amountFromBaseUnits(preflight.availableSolLamports, 9));
    const required = formatAmount(amountFromBaseUnits(preflight.requiredSolLamports, 9));
    throw new PrivateFundingError(
      `Private wallet T has ${available} SOL; this withdrawal needs ${required} SOL including temporary rent and network fees.`,
      'insufficient_sol',
    );
  }
}

function leg(record: PrivateExitRecord): PrivateFundingLegState {
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
    tradingWalletAddress: record.destinationAddress,
  };
}

function withLeg(
  record: PrivateExitRecord,
  state: PrivateFundingLegState,
  phase: PrivateFundingLegPhase,
): PrivateExitRecord {
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

async function persist(
  record: PrivateExitRecord,
  onRecord: (record: PrivateExitRecord) => void,
): Promise<void> {
  await writePrivateExitRecord(record);
  console.info('[Perpal recovery]', JSON.stringify({
    event: 'checkpoint',
    operation: 'private_withdrawal',
    phase: record.phase,
  }));
  onRecord(record);
}
