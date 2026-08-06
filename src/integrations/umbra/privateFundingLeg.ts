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
import { PrivateFundingError } from '@/integrations/umbra/privateFundingErrors';
import {
  matchingPrivateFundingNotes,
  privateFundingNoteId,
  type PrivateFundingNote,
} from '@/integrations/umbra/privateFundingNotes';
import type { UmbraGatewayDependencies } from '@/integrations/umbra/umbraGateway';

const SCAN_ATTEMPTS = 60;
const RELAY_POLL_ATTEMPTS = 100;
const POLL_INTERVAL_MS = 3_000;

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
  readonly tradingWalletAddress: string;
};

export async function runPrivateFundingLeg(input: {
  readonly client: IUmbraClient;
  readonly config: AppConfig;
  readonly dependencies: UmbraGatewayDependencies;
  readonly onState: (
    state: PrivateFundingLegState,
    phase: PrivateFundingLegPhase,
  ) => Promise<void>;
  readonly relayer: UmbraRelayer;
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

  if (state.claimSignature !== null) {
    return state;
  }

  if (state.relayRequestId !== null) {
    await resumeRelay(state.relayRequestId, input.relayer, async (signature) => {
      await save({ claimSignature: signature }, 'relaying');
    });
    return state;
  }

  if (state.depositSignature === null) {
    const scanner = getBurnableStealthPoolNoteScannerFunction({
      client: input.client,
    });

    if (state.generationIndex === null && state.populateSignature === null) {
      const existing = await scanner();
      await save({
        excludedNoteIds: matchingPrivateFundingNotes(existing, state).map(
          privateFundingNoteId,
        ),
      });
    }

    const prover = createNativeUmbraProver(
      input.config.privacy.umbraZkAssetBaseUrl,
      'createDepositWithPublicAmount',
    );
    const createNote = getATAIntoSelfBurnableStealthPoolNoteCreatorFunction(
      { client: input.client },
      {
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
      hooks: {
        onValidationComplete: async ({ generationIndex }) => {
          await save({ generationIndex: generationIndex.toString() });
        },
        populateProofAccount: {
          onPostSend: async ({ signature }) => {
            await save({ populateSignature: signature });
          },
        },
        createStealthPoolNote: {
          onPostSend: async ({ signature }) => {
            await save({ depositSignature: signature }, 'scanning');
          },
        },
      },
    };

    await createNote(
      {
        amount: BigInt(state.amountBaseUnits) as never,
        destinationAddress: address(state.tradingWalletAddress),
        mint: address(state.mint),
      },
      options,
    );
    await save({}, 'scanning');
  }

  const scanner = getBurnableStealthPoolNoteScannerFunction({
    client: input.client,
  });
  let matches: readonly PrivateFundingNote[] = [];

  for (let attempt = 0; attempt < SCAN_ATTEMPTS; attempt += 1) {
    matches = matchingPrivateFundingNotes(await scanner(), state).filter(
      (note) => !state.excludedNoteIds.includes(privateFundingNoteId(note)),
    );

    if (matches.length > 0) {
      break;
    }

    await wait(POLL_INTERVAL_MS);
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
      awaitCompletion: true,
      pollingIntervalMs: POLL_INTERVAL_MS,
      timeoutMs: RELAY_POLL_ATTEMPTS * POLL_INTERVAL_MS,
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

  if (
    batches.length !== 1 ||
    batch?.status !== 'completed' ||
    batch.failureReason != null ||
    batch.txSignature === undefined
  ) {
    throw new PrivateFundingError(
      'Umbra relayer did not complete the private claim.',
      'relay_failed',
    );
  }

  await save({ claimSignature: batch.txSignature }, 'relaying');
  return state;
}

async function resumeRelay(
  requestId: string,
  relayer: UmbraRelayer,
  onComplete: (signature: string) => Promise<void>,
): Promise<void> {
  for (let attempt = 0; attempt < RELAY_POLL_ATTEMPTS; attempt += 1) {
    const status = await relayer.pollClaimStatus(requestId);

    if (status.status === 'completed' && status.txSignature !== undefined) {
      await onComplete(status.txSignature);
      return;
    }

    if (['failed', 'timed_out', 'refunded'].includes(status.status)) {
      throw new PrivateFundingError(
        'Umbra relayer did not complete the private claim.',
        'relay_failed',
      );
    }

    await wait(POLL_INTERVAL_MS);
  }

  throw new PrivateFundingError('Umbra relayer is still processing.', 'relay_pending');
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
