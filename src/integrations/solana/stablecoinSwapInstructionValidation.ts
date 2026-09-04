import { Buffer } from 'buffer';
import {
  createAssociatedTokenAccountIdempotentInstruction,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import {
  ComputeBudgetInstruction,
  ComputeBudgetProgram,
  PublicKey,
  SystemProgram,
  type TransactionInstruction,
} from '@solana/web3.js';

const SHARED_ACCOUNTS_ROUTE_V2_DISCRIMINATOR = Uint8Array.from([
  209, 152, 83, 147, 124, 254, 216, 233,
]);
const JUPITER_EVENT_AUTHORITY = new PublicKey(
  'D8cy77BBepLMngZx6ZukaTff5hCt1HrWyKk3Hnd9oitf',
);
const JUPITER_AUTHORITY_SEED = Buffer.from('authority');
const FIXED_SHARED_ROUTE_ACCOUNTS = 12;
const SHARED_ROUTE_DATA_PREFIX_BYTES = 35;
const MIN_ROUTE_STEP_BYTES = 5;
const MAX_ROUTE_STEPS = 64;
const MAX_ROUTE_DATA_BYTES = 16_384;
// Independent ceiling: at the local 1.4M CU limit this permits at most
// 0.0014 SOL of priority fee, regardless of the gateway response.
const MAX_COMPUTE_UNIT_PRICE_MICROLAMPORTS = 1_000_000n;

export type StablecoinSwapInstructionErrorCode =
  | 'swap_compute_instruction_invalid'
  | 'swap_setup_instruction_invalid'
  | 'swap_route_instruction_invalid';

export class StablecoinSwapInstructionValidationError extends Error {
  constructor(readonly code: StablecoinSwapInstructionErrorCode) {
    super(
      'The stablecoin conversion instructions could not be verified. Request a fresh quote.',
    );
    this.name = 'StablecoinSwapInstructionValidationError';
  }
}

export function validateStablecoinSwapInstructions(input: {
  readonly amountBaseUnits: bigint;
  readonly computeInstructions: readonly TransactionInstruction[];
  readonly expectedOutputBaseUnits: bigint;
  readonly inputMint: PublicKey;
  readonly inputTokenAccount: PublicKey;
  readonly jupiterProgramId: PublicKey;
  readonly minimumOutputBaseUnits: bigint;
  readonly outputMint: PublicKey;
  readonly outputTokenAccount: PublicKey;
  readonly owner: PublicKey;
  readonly setupInstructions: readonly TransactionInstruction[];
  readonly slippageBps: number;
  readonly swapInstruction: TransactionInstruction;
}): { readonly createsTokenAccount: boolean } {
  validateComputeInstructions(input.computeInstructions);
  const createsTokenAccount = validateSetupInstructions(input);
  validateSharedAccountsRouteV2(input);
  return { createsTokenAccount };
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

function validateSetupInstructions(input: {
  readonly outputMint: PublicKey;
  readonly outputTokenAccount: PublicKey;
  readonly owner: PublicKey;
  readonly setupInstructions: readonly TransactionInstruction[];
}): boolean {
  if (input.setupInstructions.length === 0) return false;
  if (input.setupInstructions.length !== 1) {
    reject('swap_setup_instruction_invalid');
  }

  const expected = createAssociatedTokenAccountIdempotentInstruction(
    input.owner,
    input.outputTokenAccount,
    input.owner,
    input.outputMint,
    TOKEN_PROGRAM_ID,
  );
  if (!sameInstruction(input.setupInstructions[0]!, expected)) {
    // Stablecoin swaps never need arbitrary System/SPL setup operations. This
    // excludes transfers, approvals, authority changes, closes and wrapped SOL.
    reject('swap_setup_instruction_invalid');
  }
  return true;
}

function validateSharedAccountsRouteV2(input: {
  readonly amountBaseUnits: bigint;
  readonly expectedOutputBaseUnits: bigint;
  readonly inputMint: PublicKey;
  readonly inputTokenAccount: PublicKey;
  readonly jupiterProgramId: PublicKey;
  readonly minimumOutputBaseUnits: bigint;
  readonly outputMint: PublicKey;
  readonly outputTokenAccount: PublicKey;
  readonly owner: PublicKey;
  readonly slippageBps: number;
  readonly swapInstruction: TransactionInstruction;
}): void {
  const instruction = input.swapInstruction;
  if (
    !instruction.programId.equals(input.jupiterProgramId) ||
    !startsWith(instruction.data, SHARED_ACCOUNTS_ROUTE_V2_DISCRIMINATOR)
  ) {
    // Fail closed on every unreviewed Jupiter variant, including route_v2,
    // exact-out, token-ledger, cleanup and legacy route instructions.
    reject('swap_route_instruction_invalid');
  }

  const authorityId = validateSharedRouteData(instruction.data, input);
  const [programAuthority] = PublicKey.findProgramAddressSync(
    [JUPITER_AUTHORITY_SEED, Buffer.from([authorityId])],
    input.jupiterProgramId,
  );

  if (instruction.keys.length < FIXED_SHARED_ROUTE_ACCOUNTS) {
    reject('swap_route_instruction_invalid');
  }

  requireMeta(instruction, 0, programAuthority, false, false);
  requireMeta(instruction, 1, input.owner, true, false);
  requireMeta(instruction, 2, input.inputTokenAccount, false, true);
  requireIsolatedWritable(instruction, 3, input);
  requireIsolatedWritable(instruction, 4, input);
  if (instruction.keys[3]!.pubkey.equals(instruction.keys[4]!.pubkey)) {
    reject('swap_route_instruction_invalid');
  }
  requireMeta(instruction, 5, input.outputTokenAccount, false, true);
  requireMeta(instruction, 6, input.inputMint, false, false);
  requireMeta(instruction, 7, input.outputMint, false, false);
  requireMeta(instruction, 8, TOKEN_PROGRAM_ID, false, false);
  requireMeta(instruction, 9, TOKEN_PROGRAM_ID, false, false);
  requireMeta(instruction, 10, JUPITER_EVENT_AUTHORITY, false, false);
  requireMeta(instruction, 11, input.jupiterProgramId, false, false);

  validateAllAccountPrivileges(instruction, {
    ...input,
    programAuthority,
  });
}

function validateSharedRouteData(
  data: Uint8Array,
  input: {
    readonly amountBaseUnits: bigint;
    readonly expectedOutputBaseUnits: bigint;
    readonly minimumOutputBaseUnits: bigint;
    readonly slippageBps: number;
  },
): number {
  if (
    data.length < SHARED_ROUTE_DATA_PREFIX_BYTES ||
    data.length > MAX_ROUTE_DATA_BYTES
  ) {
    reject('swap_route_instruction_invalid');
  }

  const authorityId = data[8]!;
  const inAmount = readU64(data, 9);
  const quotedOutAmount = readU64(data, 17);
  const slippageBps = readU16(data, 25);
  const platformFeeBps = readU16(data, 27);
  const positiveSlippageBps = readU16(data, 29);
  const routeSteps = readU32(data, 31);
  if (
    !Number.isInteger(input.slippageBps) ||
    input.slippageBps < 0 ||
    input.slippageBps > 10_000
  ) {
    reject('swap_route_instruction_invalid');
  }
  const expectedMinimum =
    (input.expectedOutputBaseUnits * BigInt(10_000 - input.slippageBps) +
      9_999n) /
    10_000n;

  if (
    authorityId >= 16 ||
    inAmount !== input.amountBaseUnits ||
    quotedOutAmount !== input.expectedOutputBaseUnits ||
    slippageBps !== input.slippageBps ||
    platformFeeBps !== 0 ||
    positiveSlippageBps !== 0 ||
    input.minimumOutputBaseUnits !== expectedMinimum ||
    routeSteps < 1 ||
    routeSteps > MAX_ROUTE_STEPS ||
    data.length <
      SHARED_ROUTE_DATA_PREFIX_BYTES + routeSteps * MIN_ROUTE_STEP_BYTES
  ) {
    reject('swap_route_instruction_invalid');
  }

  // The route-plan suffix contains Jupiter-owned variable-size Borsh enums.
  // Its count/size are bounded here; the required pre-sign simulation performs
  // full program deserialization. All user value and authority fields precede
  // that suffix and are independently bound above.
  return authorityId;
}

function validateAllAccountPrivileges(
  instruction: TransactionInstruction,
  input: {
    readonly inputMint: PublicKey;
    readonly inputTokenAccount: PublicKey;
    readonly jupiterProgramId: PublicKey;
    readonly outputMint: PublicKey;
    readonly outputTokenAccount: PublicKey;
    readonly owner: PublicKey;
    readonly programAuthority: PublicKey;
  },
): void {
  const protectedPrograms = [
    SystemProgram.programId,
    TOKEN_PROGRAM_ID,
    TOKEN_2022_PROGRAM_ID,
    ComputeBudgetProgram.programId,
    input.jupiterProgramId,
    JUPITER_EVENT_AUTHORITY,
  ];

  instruction.keys.forEach((meta, index) => {
    if (meta.isSigner && (index !== 1 || !meta.pubkey.equals(input.owner))) {
      reject('swap_route_instruction_invalid');
    }
    if (meta.pubkey.equals(input.owner) && index !== 1) {
      reject('swap_route_instruction_invalid');
    }
    if (meta.pubkey.equals(input.inputTokenAccount) && index !== 2) {
      reject('swap_route_instruction_invalid');
    }
    if (meta.pubkey.equals(input.outputTokenAccount) && index !== 5) {
      reject('swap_route_instruction_invalid');
    }
    if (
      (meta.pubkey.equals(input.inputMint) ||
        meta.pubkey.equals(input.outputMint) ||
        meta.pubkey.equals(input.programAuthority)) &&
      (meta.isSigner || meta.isWritable)
    ) {
      reject('swap_route_instruction_invalid');
    }
    if (
      protectedPrograms.some((program) => meta.pubkey.equals(program)) &&
      (meta.isSigner || meta.isWritable)
    ) {
      reject('swap_route_instruction_invalid');
    }
  });
}

function requireIsolatedWritable(
  instruction: TransactionInstruction,
  index: number,
  input: {
    readonly inputMint: PublicKey;
    readonly inputTokenAccount: PublicKey;
    readonly jupiterProgramId: PublicKey;
    readonly outputMint: PublicKey;
    readonly outputTokenAccount: PublicKey;
    readonly owner: PublicKey;
  },
): void {
  const meta = instruction.keys[index];
  if (
    meta === undefined ||
    meta.isSigner ||
    !meta.isWritable ||
    [
      input.owner,
      input.inputTokenAccount,
      input.outputTokenAccount,
      input.inputMint,
      input.outputMint,
      input.jupiterProgramId,
      SystemProgram.programId,
      TOKEN_PROGRAM_ID,
      TOKEN_2022_PROGRAM_ID,
      ComputeBudgetProgram.programId,
      JUPITER_EVENT_AUTHORITY,
    ].some((key) => meta.pubkey.equals(key))
  ) {
    reject('swap_route_instruction_invalid');
  }
}

function requireMeta(
  instruction: TransactionInstruction,
  index: number,
  pubkey: PublicKey,
  isSigner: boolean,
  isWritable: boolean,
): void {
  const meta = instruction.keys[index];
  if (
    meta === undefined ||
    !meta.pubkey.equals(pubkey) ||
    meta.isSigner !== isSigner ||
    meta.isWritable !== isWritable
  ) {
    reject('swap_route_instruction_invalid');
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
      return (
        target !== undefined &&
        meta.pubkey.equals(target.pubkey) &&
        meta.isSigner === target.isSigner &&
        meta.isWritable === target.isWritable
      );
    }) &&
    bytesEqual(actual.data, expected.data)
  );
}

function startsWith(value: Uint8Array, prefix: Uint8Array): boolean {
  return (
    value.length >= prefix.length &&
    prefix.every((byte, index) => value[index] === byte)
  );
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return (
    left.length === right.length &&
    left.every((byte, index) => right[index] === byte)
  );
}

function readU16(value: Uint8Array, offset: number): number {
  return value[offset]! | (value[offset + 1]! << 8);
}

function readU32(value: Uint8Array, offset: number): number {
  return (
    (value[offset]! |
      (value[offset + 1]! << 8) |
      (value[offset + 2]! << 16) |
      (value[offset + 3]! << 24)) >>>
    0
  );
}

function readU64(value: Uint8Array, offset: number): bigint {
  let result = 0n;
  for (let index = 7; index >= 0; index -= 1) {
    result = (result << 8n) | BigInt(value[offset + index]!);
  }
  return result;
}

function reject(code: StablecoinSwapInstructionErrorCode): never {
  throw new StablecoinSwapInstructionValidationError(code);
}
