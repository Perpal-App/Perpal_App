import { base58, base64 } from '@scure/base';
import { Buffer } from 'buffer';
import { PublicKey, TransactionInstruction } from '@solana/web3.js';

import { validateStablecoinSwapInstructions } from '@/integrations/solana/stablecoinSwapInstructionValidation';
import {
  StablecoinSwapError,
  type SwapAsset,
  type SwapTokenAccountSnapshot,
} from '@/integrations/solana/stablecoinSwapTypes';

const JUPITER_PROGRAM_ID = new PublicKey(
  'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
);

type EncodedInstruction = {
  readonly programId: string;
  readonly accounts: readonly {
    readonly pubkey: string;
    readonly isSigner: boolean;
    readonly isWritable: boolean;
  }[];
  readonly data: string;
};

export type SwapBuildResponse = {
  readonly inputMint: string;
  readonly outputMint: string;
  readonly inAmount: string;
  readonly outAmount: string;
  readonly otherAmountThreshold: string;
  readonly swapMode: string;
  readonly slippageBps: number;
  readonly routePlan: readonly { readonly bps: number }[];
  readonly computeBudgetInstructions: readonly EncodedInstruction[];
  readonly setupInstructions: readonly EncodedInstruction[];
  readonly swapInstruction: EncodedInstruction;
  readonly cleanupInstruction: EncodedInstruction | null;
  readonly otherInstructions: readonly EncodedInstruction[];
  readonly tipInstruction: EncodedInstruction | null;
  readonly addressesByLookupTableAddress: Readonly<
    Record<string, readonly string[]>
  > | null;
  readonly blockhashWithMetadata: {
    readonly blockhash: string | readonly number[];
    readonly lastValidBlockHeight: number;
  };
};

export type DecodedStablecoinSwapBuild = {
  readonly blockhash: string;
  readonly createsInputTokenAccount: boolean;
  readonly createsOutputTokenAccount: boolean;
  readonly expectedOutputBaseUnits: bigint;
  readonly instructions: readonly TransactionInstruction[];
  readonly lastValidBlockHeight: number;
  readonly minimumOutputBaseUnits: bigint;
};

export function decodeStablecoinSwapBuildResponse(input: {
  readonly amountBaseUnits: bigint;
  readonly inputMint: PublicKey;
  readonly inputMintAddress: string;
  readonly inputSymbol: SwapAsset;
  readonly inputTokenAccount: SwapTokenAccountSnapshot;
  readonly outputMint: PublicKey;
  readonly outputMintAddress: string;
  readonly outputSymbol: SwapAsset;
  readonly outputTokenAccount: SwapTokenAccountSnapshot;
  readonly owner: PublicKey;
  readonly response: SwapBuildResponse;
}): DecodedStablecoinSwapBuild {
  const response = input.response;
  if (
    !Array.isArray(response.routePlan) ||
    !Array.isArray(response.computeBudgetInstructions) ||
    !Array.isArray(response.setupInstructions) ||
    !Array.isArray(response.otherInstructions) ||
    response.swapInstruction === null ||
    typeof response.swapInstruction !== 'object' ||
    response.blockhashWithMetadata === null ||
    typeof response.blockhashWithMetadata !== 'object' ||
    !Number.isSafeInteger(response.blockhashWithMetadata.lastValidBlockHeight) ||
    response.blockhashWithMetadata.lastValidBlockHeight <= 0
  ) {
    throw invalidPlan();
  }
  const expected = unsignedAmount(response.outAmount);
  const minimum = unsignedAmount(response.otherAmountThreshold);
  if (
    response.inputMint !== input.inputMintAddress ||
    response.outputMint !== input.outputMintAddress ||
    response.inAmount !== input.amountBaseUnits.toString() ||
    response.swapMode !== 'ExactIn' ||
    response.slippageBps !== 50 ||
    expected <= 0n ||
    minimum <= 0n ||
    minimum > expected ||
    !hasValidSwapRouteWeights(response.routePlan) ||
    response.cleanupInstruction === null ||
    response.otherInstructions.length !== 0 ||
    response.tipInstruction !== null
  ) {
    throw invalidPlan();
  }

  const compute = response.computeBudgetInstructions.map(toInstruction);
  const setup = response.setupInstructions.map(toInstruction);
  const swap = toInstruction(response.swapInstruction);
  const cleanup = toInstruction(response.cleanupInstruction);
  const validation = validateStablecoinSwapInstructions({
    amountBaseUnits: input.amountBaseUnits,
    cleanupInstruction: cleanup,
    computeInstructions: compute,
    expectedOutputBaseUnits: expected,
    inputMint: input.inputMint,
    inputSymbol: input.inputSymbol,
    inputTokenAccount: publicKey(input.inputTokenAccount.address),
    inputTokenAccountExists: input.inputTokenAccount.exists,
    jupiterProgramId: JUPITER_PROGRAM_ID,
    minimumOutputBaseUnits: minimum,
    outputMint: input.outputMint,
    outputSymbol: input.outputSymbol,
    outputTokenAccount: publicKey(input.outputTokenAccount.address),
    outputTokenAccountExists: input.outputTokenAccount.exists,
    owner: input.owner,
    setupInstructions: setup,
    slippageBps: response.slippageBps,
    swapInstruction: swap,
  });
  return {
    blockhash: decodeBlockhash(response.blockhashWithMetadata.blockhash),
    ...validation,
    expectedOutputBaseUnits: expected,
    instructions: [...compute, ...setup, swap, cleanup],
    lastValidBlockHeight: response.blockhashWithMetadata.lastValidBlockHeight,
    minimumOutputBaseUnits: minimum,
  };
}

export function hasValidSwapRouteWeights(
  routePlan: readonly unknown[],
): boolean {
  return routePlan.length > 0 &&
    routePlan.every((step) => {
      if (typeof step !== 'object' || step === null || Array.isArray(step)) return false;
      const bps = (step as { readonly bps?: unknown }).bps;
      return typeof bps === 'number' &&
        Number.isInteger(bps) && bps > 0 && bps <= 10_000;
    });
}

function toInstruction(value: EncodedInstruction): TransactionInstruction {
  try {
    if (!Array.isArray(value.accounts) || typeof value.data !== 'string') {
      throw invalidPlan();
    }
    return new TransactionInstruction({
      data: Buffer.from(base64.decode(value.data)),
      keys: value.accounts.map((account) => ({
        isSigner: account.isSigner,
        isWritable: account.isWritable,
        pubkey: publicKey(account.pubkey),
      })),
      programId: publicKey(value.programId),
    });
  } catch (cause) {
    if (cause instanceof StablecoinSwapError) throw cause;
    throw invalidPlan();
  }
}

function decodeBlockhash(value: string | readonly number[]): string {
  if (typeof value === 'string') return publicKey(value).toBase58();
  if (
    !Array.isArray(value) ||
    value.length !== 32 ||
    value.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)
  ) {
    throw invalidPlan();
  }
  return base58.encode(Uint8Array.from(value));
}

function publicKey(value: string): PublicKey {
  try {
    return new PublicKey(value);
  } catch {
    throw invalidPlan();
  }
}

function unsignedAmount(value: string): bigint {
  if (!/^\d+$/u.test(value)) throw invalidPlan();
  return BigInt(value);
}

function invalidPlan(): StablecoinSwapError {
  return new StablecoinSwapError(
    'The token swap does not match the confirmed intent.',
    'plan_invalid',
  );
}
