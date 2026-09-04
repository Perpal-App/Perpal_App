import { Buffer } from 'buffer';
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import {
  ComputeBudgetProgram,
  PublicKey,
  SystemProgram,
  type TransactionInstruction,
} from '@solana/web3.js';

import {
  StablecoinSwapInstructionValidationError,
  type StablecoinSwapInstructionErrorCode,
} from '@/integrations/solana/stablecoinSwapTypes';

const SHARED_ROUTE_V2_DISCRIMINATOR = Uint8Array.from([
  209, 152, 83, 147, 124, 254, 216, 233,
]);
const ROUTE_V2_DISCRIMINATOR = Uint8Array.from([
  187, 100, 250, 204, 49, 196, 175, 20,
]);
const JUPITER_EVENT_AUTHORITY = new PublicKey(
  'D8cy77BBepLMngZx6ZukaTff5hCt1HrWyKk3Hnd9oitf',
);
const JUPITER_AUTHORITY_SEED = Buffer.from('authority');
const SHARED_FIXED_ACCOUNTS = 12;
const ROUTE_FIXED_ACCOUNTS = 10;
const MAX_ROUTE_DATA_BYTES = 16_384;
const MAX_ROUTE_STEPS = 64;
const MIN_ROUTE_STEP_BYTES = 5;

type RouteValidationInput = {
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
};

export function validateJupiterRouteV2(input: RouteValidationInput): void {
  const instruction = input.swapInstruction;
  if (!instruction.programId.equals(input.jupiterProgramId)) reject();

  if (startsWith(instruction.data, SHARED_ROUTE_V2_DISCRIMINATOR)) {
    validateSharedRoute(input);
    return;
  }
  if (startsWith(instruction.data, ROUTE_V2_DISCRIMINATOR)) {
    validateRoute(input);
    return;
  }
  reject();
}

function validateSharedRoute(input: RouteValidationInput): void {
  const instruction = input.swapInstruction;
  const authorityId = validateRouteData(instruction.data, input, true);
  const [programAuthority] = PublicKey.findProgramAddressSync(
    [JUPITER_AUTHORITY_SEED, Buffer.from([authorityId])],
    input.jupiterProgramId,
  );
  if (instruction.keys.length < SHARED_FIXED_ACCOUNTS) reject();

  requireMeta(instruction, 0, programAuthority, false, false);
  requireMeta(instruction, 1, input.owner, true, false);
  requireMeta(instruction, 2, input.inputTokenAccount, false, true);
  requireIsolatedWritable(instruction, 3, input);
  requireIsolatedWritable(instruction, 4, input);
  if (instruction.keys[3]!.pubkey.equals(instruction.keys[4]!.pubkey)) reject();
  requireMeta(instruction, 5, input.outputTokenAccount, false, true);
  requireMeta(instruction, 6, input.inputMint, false, false);
  requireMeta(instruction, 7, input.outputMint, false, false);
  requireMeta(instruction, 8, TOKEN_PROGRAM_ID, false, false);
  requireMeta(instruction, 9, TOKEN_PROGRAM_ID, false, false);
  requireMeta(instruction, 10, JUPITER_EVENT_AUTHORITY, false, false);
  requireMeta(instruction, 11, input.jupiterProgramId, false, false);
  validatePrivileges(instruction, input, 1, programAuthority);
}

function validateRoute(input: RouteValidationInput): void {
  const instruction = input.swapInstruction;
  validateRouteData(instruction.data, input, false);
  if (instruction.keys.length < ROUTE_FIXED_ACCOUNTS) reject();

  requireMeta(instruction, 0, input.owner, true, false);
  requireMeta(instruction, 1, input.inputTokenAccount, false, true);
  requireMeta(instruction, 2, input.outputTokenAccount, false, true);
  requireMeta(instruction, 3, input.inputMint, false, false);
  requireMeta(instruction, 4, input.outputMint, false, false);
  requireMeta(instruction, 5, TOKEN_PROGRAM_ID, false, false);
  requireMeta(instruction, 6, TOKEN_PROGRAM_ID, false, false);
  // No separate SPL destination account is requested by PerPal. The optional
  // RouteV2 account therefore uses Jupiter's documented program-id sentinel.
  requireMeta(instruction, 7, input.jupiterProgramId, false, false);
  requireMeta(instruction, 8, JUPITER_EVENT_AUTHORITY, false, false);
  requireMeta(instruction, 9, input.jupiterProgramId, false, false);
  validatePrivileges(instruction, input, 0);
}

function validateRouteData(
  data: Uint8Array,
  input: Pick<
    RouteValidationInput,
    | 'amountBaseUnits'
    | 'expectedOutputBaseUnits'
    | 'minimumOutputBaseUnits'
    | 'slippageBps'
  >,
  shared: boolean,
): number {
  const prefixBytes = shared ? 35 : 34;
  if (data.length < prefixBytes || data.length > MAX_ROUTE_DATA_BYTES) reject();

  const authorityId = shared ? data[8]! : 0;
  const valuesOffset = shared ? 9 : 8;
  const inAmount = readU64(data, valuesOffset);
  const quotedOut = readU64(data, valuesOffset + 8);
  const slippageBps = readU16(data, valuesOffset + 16);
  const platformFeeBps = readU16(data, valuesOffset + 18);
  const positiveSlippageBps = readU16(data, valuesOffset + 20);
  const routeSteps = readU32(data, valuesOffset + 22);
  const expectedMinimum =
    (input.expectedOutputBaseUnits * BigInt(10_000 - input.slippageBps) + 9_999n) /
    10_000n;

  if (
    (shared && authorityId >= 16) ||
    !Number.isInteger(input.slippageBps) ||
    input.slippageBps < 0 ||
    input.slippageBps > 10_000 ||
    inAmount !== input.amountBaseUnits ||
    quotedOut !== input.expectedOutputBaseUnits ||
    slippageBps !== input.slippageBps ||
    platformFeeBps !== 0 ||
    positiveSlippageBps !== 0 ||
    input.minimumOutputBaseUnits !== expectedMinimum ||
    routeSteps < 1 ||
    routeSteps > MAX_ROUTE_STEPS ||
    data.length < prefixBytes + routeSteps * MIN_ROUTE_STEP_BYTES
  ) {
    reject();
  }
  return authorityId;
}

function validatePrivileges(
  instruction: TransactionInstruction,
  input: RouteValidationInput,
  ownerIndex: number,
  programAuthority?: PublicKey,
): void {
  const protectedReadonly = [
    SystemProgram.programId,
    TOKEN_PROGRAM_ID,
    TOKEN_2022_PROGRAM_ID,
    ComputeBudgetProgram.programId,
    input.jupiterProgramId,
    JUPITER_EVENT_AUTHORITY,
    input.inputMint,
    input.outputMint,
    ...(programAuthority === undefined ? [] : [programAuthority]),
  ];

  instruction.keys.forEach((meta, index) => {
    if (meta.isSigner && (index !== ownerIndex || !meta.pubkey.equals(input.owner))) {
      reject();
    }
    if (
      meta.pubkey.equals(input.owner) &&
      index !== ownerIndex &&
      (meta.isSigner || meta.isWritable)
    ) {
      reject();
    }
    // RouteV2 remaining accounts may legitimately alias the user's source or
    // destination token account for individual DEX legs. The fixed accounts
    // above already bind both addresses to the reviewed intent and make them
    // writable; repeating either address cannot add writable privilege. The
    // signer check at the start of this loop still rejects any alias that tries
    // to promote a token account to a signer.
    if (
      protectedReadonly.some((key) => meta.pubkey.equals(key)) &&
      (meta.isSigner || meta.isWritable)
    ) {
      reject();
    }
  });
}

function requireIsolatedWritable(
  instruction: TransactionInstruction,
  index: number,
  input: RouteValidationInput,
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
    reject();
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
    reject();
  }
}

function startsWith(value: Uint8Array, prefix: Uint8Array): boolean {
  return value.length >= prefix.length &&
    prefix.every((byte, index) => value[index] === byte);
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

function reject(
  code: StablecoinSwapInstructionErrorCode = 'swap_route_instruction_invalid',
): never {
  throw new StablecoinSwapInstructionValidationError(code);
}
