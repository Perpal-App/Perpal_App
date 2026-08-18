import { address } from '@solana/kit';
import type { IUmbraClient } from '@umbra-privacy/sdk/client';
import {
  getATAIntoSelfBurnableStealthPoolNoteCreatorFunction,
  type ATAIntoStealthPoolNoteCreatorOptions,
} from '@umbra-privacy/sdk/deposit';
import {
  getBurnableStealthPoolNoteScannerFunction,
  getSelfBurnableStealthPoolNoteIntoATABurnerFunction,
} from '@umbra-privacy/sdk/burn';
import type { UmbraRelayer } from '@umbra-privacy/sdk/relayer';

import type { AppConfig } from '@/config/appConfig';
import { createNativeUmbraProver } from '@/integrations/umbra/nativeProver';
import {
  classifyPrivateFundingFailure,
  PrivateFundingError,
} from '@/integrations/umbra/privateFundingErrors';
import {
  PRIVATE_FUNDING_RELAY_POLL_INTERVAL_MS,
  PRIVATE_FUNDING_RELAY_TIMEOUT_MS,
  pollPrivateFundingRelay,
  privateFundingRelayFailure,
} from '@/integrations/umbra/privateFundingRelayer';
import {
  matchingPrivateFundingNotes,
  privateFundingNoteId,
  type PrivateFundingNote,
} from '@/integrations/umbra/privateFundingNotes';
import { seedScanBoundary } from '@/integrations/umbra/privateFundingScanBoundary';
import { nextPrivateFundingLegAction } from '@/integrations/umbra/privateFundingState';
import type { UmbraGatewayDependencies } from '@/integrations/umbra/umbraGateway';

const SCAN_ATTEMPTS = 60;
const SCAN_POLL_INTERVAL_MS = 3_000;

export type PrivateFundingLegPhase =
  | 'depositing'
  | 'scanning'
  | 'proving'
  | 'relaying';

export type PrivateFundingLegState = {
  readonly amountBaseUnits: string;
  readonly claimSignature: string | null;
  readonly depositSignature: string | null;
  readonly excludedNoteIds: readonly string[];
  readonly generationIndex: string | null;
  readonly mint: string;
  readonly noteAmountBaseUnits: string | null;
  readonly populateSignature: string | null;
  readonly relayRequestId: string | null;
  readonly relayerFixedFeeLamports: string | null;
  readonly scanStartLeafCounts: readonly string[] | null;
  readonly tradingWalletAddress: string;
};

export async function runPrivateFundingLeg(input: {
  readonly client: IUmbraClient;
  readonly config: AppConfig;
  readonly deferRelayPolling?: boolean;
  readonly dependencies: UmbraGatewayDependencies;
  readonly onState: (
    state: PrivateFundingLegState,
    phase: PrivateFundingLegPhase,
  ) => Promise<void>;
  readonly relayer: UmbraRelayer;
  readonly returnAfterDeposit?: boolean;
  readonly state: PrivateFundingLegState;
}): Promise<PrivateFundingLegState> {
  let state = input.state;
  let phase: PrivateFundingLegPhase = state.depositSignature === null
    ? 'depositing'
    : 'scanning';
  const save = async (
    patch: Partial<PrivateFundingLegState>,
    nextPhase: PrivateFundingLegPhase = phase,
  ) => {
    state = { ...state, ...patch };
    phase = nextPhase;
    await input.onState(state, phase);
  };

  const nextAction = nextPrivateFundingLegAction({
    claimSignature: state.claimSignature,
    deferRelayPolling: input.deferRelayPolling === true,
    relayRequestId: state.relayRequestId,
  });

  if (nextAction === 'done' || nextAction === 'wait-for-peer-leg') {
    return state;
  }

  if (nextAction === 'poll-relay' && state.relayRequestId !== null) {
    const signature = await pollPrivateFundingRelay(
      input.relayer,
      state.relayRequestId,
    );
    await save({ claimSignature: signature }, 'relaying');
    return state;
  }

  if (state.scanStartLeafCounts !== null) {
    await seedScanBoundary(input.client, state.scanStartLeafCounts);
  } else if (
    state.depositSignature === null &&
    state.generationIndex === null &&
    state.populateSignature === null
  ) {
    const scanStartLeafCounts = await captureScanBoundary(input.client);
    await seedScanBoundary(input.client, scanStartLeafCounts);
    await save({ scanStartLeafCounts });
  } else {
    logFundingLeg('legacy_full_scan_required');
  }

  if (state.depositSignature === null) {
    const scanner = getBurnableStealthPoolNoteScannerFunction({
      client: input.client,
    });
    let recoveredMatches: readonly PrivateFundingNote[] = [];

    if (state.generationIndex !== null || state.populateSignature !== null) {
      recoveredMatches = matchingPrivateFundingNotes(
        await scanWithDiagnostics(scanner, 'recovery'),
        state,
      ).filter(
        (note) => !state.excludedNoteIds.includes(privateFundingNoteId(note)),
      );
    }

    if (recoveredMatches.length > 1) {
      throw new PrivateFundingError(
        'More than one matching Umbra note needs recovery review.',
        'note_ambiguous',
      );
    }

    if (recoveredMatches[0] !== undefined) {
      await save({}, 'scanning');
    } else {
      logFundingLeg('deposit_prepare_started');
      const prover = createNativeUmbraProver(
        input.config.privacy.umbraZkAssetBaseUrl,
        'createDepositWithPublicAmount',
      );
      const hooks: NonNullable<ATAIntoStealthPoolNoteCreatorOptions['hooks']> = {
        onValidationStart: async () => {
          await save({}, 'proving');
        },
        onValidationComplete: async ({ generationIndex }) => {
          await save({ generationIndex: generationIndex.toString() });
        },
        onZkProofGenerationStart: async () => {
          await save({}, 'proving');
        },
        onError: async ({ error, phase }) => {
          const diagnostic = rpcDiagnostic(error);
          console.error('[Perpal Umbra deposit]', JSON.stringify({
            event: 'sdk_error',
            errorCode: directErrorCode(error),
            errorName: error instanceof Error ? error.name : typeof error,
            phase,
            rpcDetail: diagnostic?.detail ?? null,
            rpcLogs: diagnostic?.logs ?? [],
            rpcMessage: diagnostic?.message ?? null,
          }));
        },
        populateProofAccount: {
          onPostSend: async ({ signature }: { signature: string }) => {
            await save({ populateSignature: signature }, 'depositing');
          },
        },
        createStealthPoolNote: {
          onPostSend: async ({ signature }: { signature: string }) => {
            await save({ depositSignature: signature }, 'scanning');
          },
        },
      };
      const createNote = getATAIntoSelfBurnableStealthPoolNoteCreatorFunction(
        { client: input.client },
        {
          hooks,
          zkProver: prover,
          rpc: {
            accountInfoProvider: input.dependencies.accountInfoProvider,
            blockhashProvider: input.dependencies.blockhashProvider,
            epochInfo: input.dependencies.epochInfoProvider,
            transactionForwarder: input.dependencies.transactionForwarder,
          },
        },
      );
      const options: ATAIntoStealthPoolNoteCreatorOptions = {
        ...(state.generationIndex === null
          ? {}
          : { generationIndex: BigInt(state.generationIndex) as never }),
      };

      const result = await createNote(
        {
          amount: BigInt(state.amountBaseUnits) as never,
          destinationAddress: address(state.tradingWalletAddress),
          mint: address(state.mint),
        },
        options,
      );
      await save(
        {
          depositSignature: result.createUtxoSignature,
          populateSignature: result.populateProofAccountSignature,
        },
        'scanning',
      );

      if (input.returnAfterDeposit === true) {
        return state;
      }
    }
  }

  const scanner = getBurnableStealthPoolNoteScannerFunction({
    client: input.client,
  });
  let matches: readonly PrivateFundingNote[] = [];
  const scanLoopStartedAtMs = performance.now();

  for (let attempt = 0; attempt < SCAN_ATTEMPTS; attempt += 1) {
    matches = matchingPrivateFundingNotes(
      await scanWithDiagnostics(
        scanner,
        'deposit',
        attempt + 1,
        scanLoopStartedAtMs,
      ),
      state,
    ).filter(
      (note) => !state.excludedNoteIds.includes(privateFundingNoteId(note)),
    );

    if (matches.length > 0) {
      break;
    }

    if (attempt + 1 < SCAN_ATTEMPTS) {
      await wait(SCAN_POLL_INTERVAL_MS);
    }
  }

  if (matches.length !== 1 || matches[0]?.kind !== 'self-burnable') {
    throw new PrivateFundingError(
      matches.length === 0
        ? 'Umbra is still indexing the private deposit. Resume shortly.'
        : 'More than one matching Umbra note needs recovery review.',
      matches.length === 0 ? 'indexer_pending' : 'note_ambiguous',
    );
  }

  if (input.client.fetchBatchMerkleProof === undefined) {
    throw new PrivateFundingError('Umbra indexer is unavailable.', 'indexer_unavailable');
  }

  const note = matches[0];
  await save(
    {
      noteAmountBaseUnits: note.amount.toString(),
      relayerFixedFeeLamports: note.h1Components.relayerFixedSolFees.toString(),
    },
    'proving',
  );
  const nativeProver = createNativeUmbraProver(
    input.config.privacy.umbraZkAssetBaseUrl,
    'claimDepositIntoPublicAmount:n1',
  );
  const burn = getSelfBurnableStealthPoolNoteIntoATABurnerFunction(
    { client: input.client },
    {
      fetchBatchMerkleProof: input.client.fetchBatchMerkleProof,
      zkProver: { maxUtxoCapacity: 1, prove: nativeProver.prove },
      relayer: {
        submitBurn: input.relayer.submitClaim,
        pollBurnStatus: input.relayer.pollClaimStatus,
        getRelayerAddress: input.relayer.getRelayerAddress,
      },
      awaitCompletion: input.deferRelayPolling !== true,
      pollingIntervalMs: PRIVATE_FUNDING_RELAY_POLL_INTERVAL_MS,
      timeoutMs: PRIVATE_FUNDING_RELAY_TIMEOUT_MS,
      hooks: {
        onBatchSubmitted: async ({ requestId }) => {
          await save({ relayRequestId: requestId }, 'relaying');
        },
      },
    },
  );
  const result = await burn([note]);
  const batches = [...result.batches.values()];
  const batch = batches[0];

  if (input.deferRelayPolling === true) {
    const requestId = state.relayRequestId ?? batch?.requestId;

    if (batches.length !== 1 || requestId === undefined) {
      throw privateFundingRelayFailure(
        batch?.failureReason,
        batch?.status ?? 'missing_batch',
      );
    }

    if (state.relayRequestId === null) {
      await save({ relayRequestId: requestId }, 'relaying');
    }
    return state;
  }

  if (
    batches.length !== 1 ||
    batch?.status !== 'completed' ||
    batch.failureReason != null ||
    batch.txSignature === undefined
  ) {
    throw privateFundingRelayFailure(
      batch?.failureReason,
      batch?.status ?? 'missing_batch',
    );
  }

  await save({ claimSignature: batch.txSignature }, 'relaying');
  return state;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function logFundingLeg(event: string): void {
  console.info('[Perpal Umbra deposit]', JSON.stringify({ event }));
}

async function captureScanBoundary(
  client: IUmbraClient,
): Promise<readonly string[]> {
  if (client.fetchTreeSummary === undefined) {
    throw new PrivateFundingError(
      'Umbra indexer tree data is unavailable.',
      'indexer_unavailable',
    );
  }

  const startedAtMs = performance.now();
  console.info('[Perpal Umbra deposit]', JSON.stringify({
    event: 'scan_boundary_started',
  }));

  const summaries = await client.fetchTreeSummary();
  const boundary = summaries.map(
    ({ treeIndex, numLeaves }) => `${treeIndex.toString()}:${numLeaves.toString()}`,
  );

  console.info('[Perpal Umbra deposit]', JSON.stringify({
    durationMs: Math.round(performance.now() - startedAtMs),
    event: 'scan_boundary_completed',
    treeCount: boundary.length,
  }));
  return boundary;
}

function directErrorCode(cause: unknown): string {
  if (
    typeof cause === 'object' &&
    cause !== null &&
    typeof (cause as { readonly code?: unknown }).code === 'string'
  ) {
    return (cause as { readonly code: string }).code.toLowerCase();
  }

  return classifyPrivateFundingFailure(cause);
}

function rpcDiagnostic(cause: unknown): {
  readonly detail: string | null;
  readonly logs: readonly string[];
  readonly message: string;
} | null {
  if (typeof cause !== 'object' || cause === null) {
    return null;
  }

  const diagnostic = (cause as { readonly diagnostic?: unknown }).diagnostic;
  if (typeof diagnostic !== 'object' || diagnostic === null) {
    return null;
  }

  const value = diagnostic as {
    readonly detail?: unknown;
    readonly logs?: unknown;
    readonly message?: unknown;
  };
  return {
    detail: typeof value.detail === 'string' ? value.detail : null,
    logs: Array.isArray(value.logs)
      ? value.logs.filter((entry): entry is string => typeof entry === 'string')
      : [],
    message: typeof value.message === 'string' ? value.message : 'Solana RPC error.',
  };
}

async function scanWithDiagnostics<T>(
  scanner: () => Promise<T>,
  stage: 'recovery' | 'deposit',
  attempt?: number,
  loopStartedAtMs?: number,
): Promise<T> {
  const startedAtMs = performance.now();
  console.info('[Perpal Umbra deposit]', JSON.stringify({
    attempt: attempt ?? null,
    elapsedMs: loopStartedAtMs === undefined
      ? null
      : Math.round(startedAtMs - loopStartedAtMs),
    event: 'scan_started',
    stage,
  }));

  try {
    const result = await scanner();
    console.info('[Perpal Umbra deposit]', JSON.stringify({
      attempt: attempt ?? null,
      durationMs: Math.round(performance.now() - startedAtMs),
      event: 'scan_completed',
      stage,
    }));
    return result;
  } catch (cause) {
    const details = typeof cause === 'object' && cause !== null
      ? cause as {
          readonly code?: unknown;
          readonly context?: unknown;
          readonly cause?: unknown;
          readonly name?: unknown;
          readonly operation?: unknown;
          readonly stage?: unknown;
          readonly statusCode?: unknown;
        }
      : null;
    console.error('[Perpal Umbra deposit]', JSON.stringify({
      attempt: attempt ?? null,
      durationMs: Math.round(performance.now() - startedAtMs),
      event: 'scan_error',
      errorCode: directErrorCode(cause),
      errorName: safeDiagnosticLabel(details?.name),
      solanaCode: solanaErrorCode(details?.context),
      solanaCauseCode: solanaErrorCode(
        typeof details?.cause === 'object' && details.cause !== null
          ? (details.cause as { readonly context?: unknown }).context
          : null,
      ),
      operation: safeDiagnosticLabel(details?.operation),
      sdkStage: safeDiagnosticLabel(details?.stage),
      stage,
      statusCode: typeof details?.statusCode === 'number'
        ? details.statusCode
        : null,
    }));
    throw cause;
  }
}

function solanaErrorCode(context: unknown): number | null {
  if (typeof context !== 'object' || context === null) {
    return null;
  }

  const code = (context as { readonly __code?: unknown }).__code;
  return typeof code === 'number' && Number.isSafeInteger(code) ? code : null;
}

function safeDiagnosticLabel(value: unknown): string | null {
  return typeof value === 'string' && /^[a-z0-9_-]{1,64}$/iu.test(value)
    ? value
    : null;
}
