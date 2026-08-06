import * as Crypto from 'expo-crypto';
import { getUmbraRelayer } from '@umbra-privacy/sdk/relayer';

import type { AppConfig } from '@/config/appConfig';
import type { GatewayRequestSigner } from '@/integrations/api/gatewayClient';
import { PrivateFundingError } from '@/integrations/umbra/privateFundingErrors';
import {
  assertRelayerSupportsMint,
  createPrivateFundingClient,
} from '@/integrations/umbra/privateFundingClient';
import {
  runPrivateFundingLeg,
  type PrivateFundingLegPhase,
  type PrivateFundingLegState,
} from '@/integrations/umbra/privateFundingLeg';
import { createUmbraLocalGatewayDependencies } from '@/integrations/umbra/umbraGateway';
import {
  readPrivateExitRecord,
  writePrivateExitRecord,
  type PrivateExitRecord,
} from '@/integrations/umbra/privateExitStorage';

type Input = {
  readonly amountBaseUnits: bigint;
  readonly config: AppConfig;
  readonly destinationAddress: string;
  readonly gatewaySigner: GatewayRequestSigner;
  readonly mint: string;
  readonly sourceWalletAddress: string;
  readonly symbol: 'USDC' | 'USDT';
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

async function runExit(
  initial: PrivateExitRecord,
  input: Input,
  onRecord: (record: PrivateExitRecord) => void,
): Promise<PrivateExitRecord> {
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
    const relayer = getUmbraRelayer({ apiEndpoint: input.config.privacy.umbraRelayerUrl });
    await assertRelayerSupportsMint(relayer, record.mint);
    await runPrivateFundingLeg({
      client,
      config: input.config,
      dependencies,
      relayer,
      state: leg(record),
      onState: async (state, phase) => save(withLeg(record, state, phase)),
    });
    await save({ ...record, phase: 'complete', errorCode: null, updatedAtMs: Date.now() });
    return record;
  } catch (cause) {
    const code = cause instanceof PrivateFundingError ? cause.code : 'withdraw_failed';
    await save({ ...record, errorCode: code, updatedAtMs: Date.now() });
    throw cause;
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
