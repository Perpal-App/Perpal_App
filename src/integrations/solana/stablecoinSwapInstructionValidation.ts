import {
  createAssociatedTokenAccountIdempotentInstruction,
  createCloseAccountInstruction,
  createSyncNativeInstruction,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import {
  ComputeBudgetInstruction,
  ComputeBudgetProgram,
  PublicKey,
  SystemProgram,
  type TransactionInstruction,
} from '@solana/web3.js';

import { validateJupiterRouteV2 } from '@/integrations/solana/stablecoinSwapRouteValidation';
import {
  StablecoinSwapInstructionValidationError,
  type StablecoinSwapInstructionErrorCode,
  type SwapAsset,
} from '@/integrations/solana/stablecoinSwapTypes';

// At the local 1.4M CU limit this permits at most 0.0014 SOL of priority fee.
const MAX_COMPUTE_UNIT_PRICE_MICROLAMPORTS = 1_000_000n;

export {
  StablecoinSwapInstructionValidationError,
  type StablecoinSwapInstructionErrorCode,
};

type ValidationInput = {
  readonly amountBaseUnits: bigint;
  readonly cleanupInstruction: TransactionInstruction | null;
  readonly computeInstructions: readonly TransactionInstruction[];
  readonly expectedOutputBaseUnits: bigint;
  readonly inputMint: PublicKey;
  readonly inputSymbol: SwapAsset;
  readonly inputTokenAccount: PublicKey;
  readonly inputTokenAccountExists: boolean;
  readonly jupiterProgramId: PublicKey;
  readonly minimumOutputBaseUnits: bigint;
  readonly outputMint: PublicKey;
  readonly outputSymbol: SwapAsset;
  readonly outputTokenAccount: PublicKey;
  readonly outputTokenAccountExists: boolean;
  readonly owner: PublicKey;
  readonly setupInstructions: readonly TransactionInstruction[];
  readonly slippageBps: number;
  readonly swapInstruction: TransactionInstruction;
};

export type StablecoinSwapInstructionValidation = {
  readonly createsInputTokenAccount: boolean;
  readonly createsOutputTokenAccount: boolean;
};

export function validateStablecoinSwapInstructions(
  input: ValidationInput,
): StablecoinSwapInstructionValidation {
  validateComputeInstructions(input.computeInstructions);
  const setup = validateSetupInstructions(input);
  validateJupiterRouteV2(input);
  validateCleanupInstruction(input);
  return setup;
}

function validateComputeInstructions(
  instructions: readonly TransactionInstruction[],
): void {
  if (instructions.length > 1) reject('swap_compute_instruction_invalid');
  const instruction = instructions[0];
  if (instruction === undefined) return;

  try {
    if (
      !instruction.programId.equals(ComputeBudgetProgram.programId) ||
      instruction.keys.length !== 0 ||
      ComputeBudgetInstruction.decodeInstructionType(instruction) !==
        'SetComputeUnitPrice'
    ) {
      reject('swap_compute_instruction_invalid');
    }
    const { microLamports } =
      ComputeBudgetInstruction.decodeSetComputeUnitPrice(instruction);
    if (
      (typeof microLamports === 'number' &&
        (!Number.isSafeInteger(microLamports) || microLamports < 0)) ||
      (typeof microLamports === 'bigint' && microLamports < 0n) ||
      BigInt(microLamports) > MAX_COMPUTE_UNIT_PRICE_MICROLAMPORTS ||
      !sameInstruction(
        instruction,
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports }),
      )
    ) {
      reject('swap_compute_instruction_invalid');
    }
  } catch (cause) {
    if (cause instanceof StablecoinSwapInstructionValidationError) throw cause;
    reject('swap_compute_instruction_invalid');
  }
}

function validateSetupInstructions(
  input: ValidationInput,
): StablecoinSwapInstructionValidation {
  if (input.inputSymbol === 'SOL') return validateSolInputSetup(input);
  return validateSolOutputSetup(input);
}

function validateSolInputSetup(
  input: ValidationInput,
): StablecoinSwapInstructionValidation {
  let index = 0;
  const createsInput = consumeInstruction(
    input.setupInstructions,
    index,
    createAta(input.owner, input.inputTokenAccount, input.inputMint),
  );
  if (createsInput) index += 1;
  if (!input.inputTokenAccountExists && !createsInput) {
    reject('swap_setup_instruction_invalid');
  }

  requireInstruction(
    input.setupInstructions,
    index,
    SystemProgram.transfer({
      fromPubkey: input.owner,
      lamports: input.amountBaseUnits,
      toPubkey: input.inputTokenAccount,
    }),
  );
  index += 1;
  requireInstruction(
    input.setupInstructions,
    index,
    createSyncNativeInstruction(input.inputTokenAccount, TOKEN_PROGRAM_ID),
  );
  index += 1;

  const createsOutput = consumeInstruction(
    input.setupInstructions,
    index,
    createAta(input.owner, input.outputTokenAccount, input.outputMint),
  );
  if (createsOutput) index += 1;
  if (!input.outputTokenAccountExists && !createsOutput) {
    reject('swap_setup_instruction_invalid');
  }
  if (index !== input.setupInstructions.length) {
    reject('swap_setup_instruction_invalid');
  }
  return {
    createsInputTokenAccount: createsInput,
    createsOutputTokenAccount: createsOutput,
  };
}

function validateSolOutputSetup(
  input: ValidationInput,
): StablecoinSwapInstructionValidation {
  if (!input.inputTokenAccountExists) {
    reject('swap_setup_instruction_invalid');
  }
  const createsOutput = consumeInstruction(
    input.setupInstructions,
    0,
    createAta(input.owner, input.outputTokenAccount, input.outputMint),
  );
  if (
    (!input.outputTokenAccountExists && !createsOutput) ||
    input.setupInstructions.length !== (createsOutput ? 1 : 0)
  ) {
    reject('swap_setup_instruction_invalid');
  }
  return {
    createsInputTokenAccount: false,
    createsOutputTokenAccount: createsOutput,
  };
}

function validateCleanupInstruction(input: ValidationInput): void {
  const wrappedSolAccount = input.inputSymbol === 'SOL'
    ? input.inputTokenAccount
    : input.outputTokenAccount;
  const cleanup = input.cleanupInstruction;
  if (
    cleanup === null ||
    !sameInstruction(
      cleanup,
      createCloseAccountInstruction(
        wrappedSolAccount,
        input.owner,
        input.owner,
        [],
        TOKEN_PROGRAM_ID,
      ),
    )
  ) {
    reject('swap_cleanup_instruction_invalid');
  }
}

function createAta(
  owner: PublicKey,
  account: PublicKey,
  mint: PublicKey,
): TransactionInstruction {
  return createAssociatedTokenAccountIdempotentInstruction(
    owner,
    account,
    owner,
    mint,
    TOKEN_PROGRAM_ID,
  );
}

function consumeInstruction(
  instructions: readonly TransactionInstruction[],
  index: number,
  expected: TransactionInstruction,
): boolean {
  const actual = instructions[index];
  return actual !== undefined && sameInstruction(actual, expected);
}

function requireInstruction(
  instructions: readonly TransactionInstruction[],
  index: number,
  expected: TransactionInstruction,
): void {
  const actual = instructions[index];
  if (actual === undefined || !sameInstruction(actual, expected)) {
    reject('swap_setup_instruction_invalid');
  }
}

function sameInstruction(
  actual: TransactionInstruction,
  expected: TransactionInstruction,
): boolean {
  return (
    actual.programId.equals(expected.programId) &&
    actual.keys.length === expected.keys.length &&
    actual.keys.every((meta, index) => {
      const target = expected.keys[index];
      return target !== undefined &&
        meta.pubkey.equals(target.pubkey) &&
        meta.isSigner === target.isSigner &&
        meta.isWritable === target.isWritable;
    }) &&
    actual.data.length === expected.data.length &&
    actual.data.every((byte, index) => expected.data[index] === byte)
  );
}

function reject(code: StablecoinSwapInstructionErrorCode): never {
  throw new StablecoinSwapInstructionValidationError(code);
}
