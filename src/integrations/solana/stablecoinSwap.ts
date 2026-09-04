import { base58, base64 } from '@scure/base';
import { Buffer } from 'buffer';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import {
  AddressLookupTableAccount,
  ComputeBudgetProgram,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';

import {
  postSignedGatewayRequest,
  type GatewayRequestSigner,
} from '@/integrations/api/gatewayClient';
import { signedSolanaRpc } from '@/integrations/api/signedSolanaRpc';

const JUPITER_PROGRAM_ID = new PublicKey(
  'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
);
const MAX_COMPUTE_UNITS = 1_400_000;
const TOKEN_ACCOUNT_BYTES = 165;

type EncodedInstruction = {
  readonly programId: string;
  readonly accounts: readonly {
    readonly pubkey: string;
    readonly isSigner: boolean;
    readonly isWritable: boolean;
  }[];
  readonly data: string;
};

type SwapBuildResponse = {
  readonly inputMint: string;
  readonly outputMint: string;
  readonly inAmount: string;
  readonly outAmount: string;
  readonly otherAmountThreshold: string;
  readonly swapMode: string;
  readonly slippageBps: number;
  readonly routePlan: readonly {
    readonly bps: number;
    readonly swapInfo: {
      readonly inputMint: string;
      readonly outputMint: string;
      readonly inAmount: string;
      readonly outAmount: string;
    };
  }[];
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

export type StablecoinSwapPlan = {
  readonly createsTokenAccount: boolean;
  readonly expectedOutputBaseUnits: bigint;
  readonly feeLamports: bigint;
  readonly inputMint: string;
  readonly minimumOutputBaseUnits: bigint;
  readonly outputTokenAccount: string;
  readonly rentLamports: bigint;
  readonly requiredSolLamports: bigint;
  readonly solBalanceLamports: bigint;
  readonly transaction: VersionedTransaction;
};

export class StablecoinSwapError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = 'StablecoinSwapError';
  }
}

export async function prepareStablecoinSwap(input: {
  readonly amountBaseUnits: bigint;
  readonly inputMint: string;
  readonly outputMint: string;
  readonly owner: string;
  readonly rpcUrl: string;
  readonly signal?: AbortSignal;
  readonly signer: GatewayRequestSigner;
  readonly swapBuildUrl: string;
}): Promise<StablecoinSwapPlan> {
  const owner = new PublicKey(input.owner);

  if (
    input.amountBaseUnits <= 0n ||
    input.inputMint === input.outputMint
  ) {
    throw invalidPlan();
  }

  const response = await postSignedGatewayRequest<SwapBuildResponse>({
    body: {
      amount: input.amountBaseUnits.toString(),
      inputMint: input.inputMint,
      outputMint: input.outputMint,
      taker: input.owner,
    },
    cluster: 'mainnet',
    operation: 'swap.build',
    signer: input.signer,
    timeoutMs: 10_000,
    url: input.swapBuildUrl,
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  });
  const decoded = decodeBuildResponse(response, input, owner);
  const simulationTransaction = buildTransaction(
    decoded,
    owner,
    MAX_COMPUTE_UNITS,
  );
  const [previewFee, solBalance, tokenAccountRent] = await Promise.all([
    signedSolanaRpc<{ readonly value: number | null }>({
      method: 'getFeeForMessage',
      params: [base64.encode(simulationTransaction.message.serialize()), { commitment: 'confirmed' }],
      rpcUrl: input.rpcUrl,
      signer: input.signer,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    }),
    signedSolanaRpc<{ readonly value: number }>({
      method: 'getBalance',
      params: [input.owner, { commitment: 'confirmed' }],
      rpcUrl: input.rpcUrl,
      signer: input.signer,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    }),
    decoded.createsTokenAccount
      ? signedSolanaRpc<number>({
          method: 'getMinimumBalanceForRentExemption',
          params: [TOKEN_ACCOUNT_BYTES, { commitment: 'confirmed' }],
          rpcUrl: input.rpcUrl,
          signer: input.signer,
          ...(input.signal === undefined ? {} : { signal: input.signal }),
        })
      : Promise.resolve(0),
  ]);

  assertStablecoinSwapSolFunding(previewFee.value, solBalance.value, tokenAccountRent);
  const simulation = await signedSolanaRpc<{
    readonly value: {
      readonly err: unknown;
      readonly unitsConsumed?: number;
    };
  }>({
    method: 'simulateTransaction',
    params: [
      base64.encode(simulationTransaction.serialize()),
      {
        commitment: 'confirmed',
        encoding: 'base64',
        replaceRecentBlockhash: true,
        sigVerify: false,
      },
    ],
    rpcUrl: input.rpcUrl,
    signer: input.signer,
    timeoutMs: 12_000,
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  });

  if (
    simulation.value.err !== null ||
    simulation.value.unitsConsumed === undefined ||
    !Number.isSafeInteger(simulation.value.unitsConsumed) ||
    simulation.value.unitsConsumed <= 0
  ) {
    throw new StablecoinSwapError(
      'The stablecoin conversion preview failed.',
      'simulation_failed',
    );
  }

  const computeUnits = Math.min(
    MAX_COMPUTE_UNITS,
    Math.ceil(simulation.value.unitsConsumed * 1.15),
  );

  const transaction = buildTransaction(decoded, owner, computeUnits);
  const fee = await signedSolanaRpc<{ readonly value: number | null }>({
    method: 'getFeeForMessage',
    params: [base64.encode(transaction.message.serialize()), { commitment: 'confirmed' }],
    rpcUrl: input.rpcUrl,
    signer: input.signer,
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  });

  const feeLamports = fee.value;
  assertStablecoinSwapSolFunding(feeLamports, solBalance.value, tokenAccountRent);
  const requiredSolLamports = BigInt(feeLamports) + BigInt(tokenAccountRent);

  return {
    createsTokenAccount: decoded.createsTokenAccount,
    expectedOutputBaseUnits: decoded.expectedOutputBaseUnits,
    feeLamports: BigInt(feeLamports),
    inputMint: input.inputMint,
    minimumOutputBaseUnits: decoded.minimumOutputBaseUnits,
    outputTokenAccount: decoded.outputTokenAccount.toBase58(),
    rentLamports: BigInt(tokenAccountRent),
    requiredSolLamports,
    solBalanceLamports: BigInt(solBalance.value),
    transaction,
  };
}

export function assertStablecoinSwapSolFunding(
  feeLamports: number | null,
  solBalanceLamports: number,
  rentLamports: number,
): asserts feeLamports is number {
  if (
    feeLamports === null ||
    !Number.isSafeInteger(feeLamports) ||
    feeLamports < 0 ||
    !Number.isSafeInteger(solBalanceLamports) ||
    solBalanceLamports < 0 ||
    !Number.isSafeInteger(rentLamports) ||
    rentLamports < 0
  ) {
    throw new StablecoinSwapError('The network fee could not be verified.', 'fee_invalid');
  }
  if (solBalanceLamports < feeLamports + rentLamports) {
    throw new StablecoinSwapError(
      rentLamports > 0
        ? 'This wallet needs more SOL for the network fee and first-time token-account rent.'
        : 'This wallet needs more SOL for the network fee.',
      'insufficient_sol',
    );
  }
}

export function hasValidSwapRouteWeights(
  routePlan: readonly { readonly bps: number }[],
): boolean {
  return routePlan.length > 0 && routePlan.every(
    ({ bps }) => Number.isInteger(bps) && bps > 0 && bps <= 10_000,
  );
}

export async function readTokenBalance(input: {
  readonly decimals?: number;
  readonly mint: string;
  readonly owner: string;
  readonly rpcUrl: string;
  readonly signal?: AbortSignal;
  readonly signer: GatewayRequestSigner;
}): Promise<bigint> {
  const tokenAccount = getAssociatedTokenAddressSync(
    new PublicKey(input.mint),
    new PublicKey(input.owner),
  );
  const account = await signedSolanaRpc<{
    readonly value: null | { readonly owner: string };
  }>({
    method: 'getAccountInfo',
    params: [tokenAccount.toBase58(), { commitment: 'confirmed', encoding: 'base64' }],
    rpcUrl: input.rpcUrl,
    signer: input.signer,
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  });

  if (account.value === null) {
    return 0n;
  }

  const balance = await signedSolanaRpc<{
    readonly value: { readonly amount: string; readonly decimals: number };
  }>({
    method: 'getTokenAccountBalance',
    params: [tokenAccount.toBase58(), { commitment: 'confirmed' }],
    rpcUrl: input.rpcUrl,
    signer: input.signer,
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  });

  const expectedDecimals = input.decimals ?? 6;
  if (
    !Number.isInteger(expectedDecimals) ||
    expectedDecimals < 0 ||
    expectedDecimals > 255 ||
    balance.value.decimals !== expectedDecimals ||
    !/^\d+$/u.test(balance.value.amount)
  ) {
    throw new StablecoinSwapError(
      'The token balance is invalid.',
      'balance_invalid',
    );
  }

  return BigInt(balance.value.amount);
}

type DecodedBuild = {
  readonly blockhash: string;
  readonly createsTokenAccount: boolean;
  readonly expectedOutputBaseUnits: bigint;
  readonly instructions: readonly TransactionInstruction[];
  readonly lookupTables: readonly AddressLookupTableAccount[];
  readonly minimumOutputBaseUnits: bigint;
  readonly outputTokenAccount: PublicKey;
};

function decodeBuildResponse(
  response: SwapBuildResponse,
  input: {
    readonly amountBaseUnits: bigint;
    readonly inputMint: string;
    readonly outputMint: string;
  },
  owner: PublicKey,
): DecodedBuild {
  const expected = unsignedAmount(response.outAmount);
  const minimum = unsignedAmount(response.otherAmountThreshold);

  if (
    response.inputMint !== input.inputMint ||
    response.outputMint !== input.outputMint ||
    response.inAmount !== input.amountBaseUnits.toString() ||
    response.swapMode !== 'ExactIn' ||
    response.slippageBps !== 50 ||
    expected <= 0n ||
    minimum <= 0n ||
    minimum > expected ||
    !hasValidSwapRouteWeights(response.routePlan) ||
    response.cleanupInstruction !== null ||
    response.otherInstructions.length !== 0 ||
    response.tipInstruction !== null
  ) {
    throw invalidPlan();
  }

  const inputTokenAccount = getAssociatedTokenAddressSync(
    new PublicKey(input.inputMint),
    owner,
  );
  const outputTokenAccount = getAssociatedTokenAddressSync(
    new PublicKey(input.outputMint),
    owner,
  );
  const compute = response.computeBudgetInstructions.map(toInstruction);
  const setup = response.setupInstructions.map(toInstruction);
  const swap = toInstruction(response.swapInstruction);
  const allowedSetupPrograms = [
    ASSOCIATED_TOKEN_PROGRAM_ID,
    SystemProgram.programId,
    TOKEN_PROGRAM_ID,
    TOKEN_2022_PROGRAM_ID,
  ];

  if (
    compute.some((instruction) =>
      !instruction.programId.equals(ComputeBudgetProgram.programId),
    ) ||
    setup.some((instruction) =>
      !allowedSetupPrograms.some((program) => instruction.programId.equals(program)),
    ) ||
    !swap.programId.equals(JUPITER_PROGRAM_ID) ||
    ![...compute, ...setup, swap].every((instruction) =>
      instruction.keys.every(
        (account) => !account.isSigner || account.pubkey.equals(owner),
      ),
    ) ||
    !swap.keys.some((account) => account.pubkey.equals(inputTokenAccount)) ||
    !swap.keys.some((account) => account.pubkey.equals(outputTokenAccount))
  ) {
    throw invalidPlan();
  }

  return {
    blockhash: decodeBlockhash(response.blockhashWithMetadata.blockhash),
    createsTokenAccount: setup.some((instruction) =>
      instruction.keys.some((account) => account.pubkey.equals(outputTokenAccount)),
    ),
    expectedOutputBaseUnits: expected,
    instructions: [...compute, ...setup, swap],
    lookupTables: decodeLookupTables(response.addressesByLookupTableAddress),
    minimumOutputBaseUnits: minimum,
    outputTokenAccount,
  };
}

function buildTransaction(
  build: DecodedBuild,
  owner: PublicKey,
  computeUnits: number,
): VersionedTransaction {
  const instructions = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnits }),
    ...build.instructions,
  ];
  const message = new TransactionMessage({
    instructions,
    payerKey: owner,
    recentBlockhash: build.blockhash,
  }).compileToV0Message([...build.lookupTables]);
  return new VersionedTransaction(message);
}

function toInstruction(value: EncodedInstruction): TransactionInstruction {
  try {
    return new TransactionInstruction({
      data: Buffer.from(base64.decode(value.data)),
      keys: value.accounts.map((account) => ({
        isSigner: account.isSigner,
        isWritable: account.isWritable,
        pubkey: new PublicKey(account.pubkey),
      })),
      programId: new PublicKey(value.programId),
    });
  } catch {
    throw invalidPlan();
  }
}

function decodeLookupTables(
  value: SwapBuildResponse['addressesByLookupTableAddress'],
): readonly AddressLookupTableAccount[] {
  if (value === null) {
    return [];
  }

  try {
    return Object.entries(value).map(
      ([table, addresses]) =>
        new AddressLookupTableAccount({
          key: new PublicKey(table),
          state: {
            addresses: addresses.map((entry) => new PublicKey(entry)),
            deactivationSlot: BigInt('18446744073709551615'),
            lastExtendedSlot: 0,
            lastExtendedSlotStartIndex: 0,
          },
        }),
    );
  } catch {
    throw invalidPlan();
  }
}

function decodeBlockhash(value: string | readonly number[]): string {
  if (typeof value === 'string') {
    return new PublicKey(value).toBase58();
  }

  if (
    value.length !== 32 ||
    value.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)
  ) {
    throw invalidPlan();
  }

  return base58.encode(Uint8Array.from(value));
}

function unsignedAmount(value: string): bigint {
  if (!/^\d+$/u.test(value)) {
    throw invalidPlan();
  }
  return BigInt(value);
}

function invalidPlan(): StablecoinSwapError {
  return new StablecoinSwapError(
    'The stablecoin conversion does not match the confirmed funding intent.',
    'plan_invalid',
  );
}
