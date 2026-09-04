import { base64 } from '@scure/base';
import { Buffer } from 'buffer';
import { NATIVE_MINT } from '@solana/spl-token';
import {
  ComputeBudgetProgram,
  PublicKey,
  TransactionMessage,
  type AddressLookupTableAccount,
  VersionedTransaction,
} from '@solana/web3.js';

import {
  postSignedGatewayRequest,
  type GatewayRequestSigner,
} from '@/integrations/api/gatewayClient';
import { signedSolanaRpc } from '@/integrations/api/signedSolanaRpc';
import {
  readNativeSolBalance,
  readSwapTokenAccount,
  readTokenAccountRent,
} from '@/integrations/solana/stablecoinSwapBalances';
import {
  decodeStablecoinSwapBuildResponse,
  type DecodedStablecoinSwapBuild,
  type SwapBuildResponse,
} from '@/integrations/solana/stablecoinSwapBuildResponse';
import { readVerifiedStablecoinSwapLookupTables } from '@/integrations/solana/stablecoinSwapLookupTables';
import {
  StablecoinSwapError,
  swapAssetDecimals,
  type StablecoinSwapPlan,
  type SwapAsset,
  type SwapTokenAccountSnapshot,
} from '@/integrations/solana/stablecoinSwapTypes';

const MAX_COMPUTE_UNITS = 1_400_000;
export const MAX_SWAP_NETWORK_FEE_LAMPORTS = 2_000_000n;

type PrepareSwapInput = {
  readonly amountBaseUnits: bigint;
  readonly inputMint: string;
  readonly inputSymbol: SwapAsset;
  readonly outputMint: string;
  readonly outputSymbol: SwapAsset;
  readonly owner: string;
  readonly rpcUrl: string;
  readonly signal?: AbortSignal;
  readonly signer: GatewayRequestSigner;
  readonly swapBuildUrl: string;
};

export {
  readTokenBalance,
  readNativeSolBalance,
  readSwapAssetBalance,
} from '@/integrations/solana/stablecoinSwapBalances';
export {
  StablecoinSwapError,
  swapAssetDecimals,
  type StablecoinSwapPlan,
  type SwapAsset,
} from '@/integrations/solana/stablecoinSwapTypes';
export { hasValidSwapRouteWeights } from '@/integrations/solana/stablecoinSwapBuildResponse';

export async function prepareStablecoinSwap(
  input: PrepareSwapInput,
): Promise<StablecoinSwapPlan> {
  validateSwapIntent(input);
  const owner = publicKey(input.owner);
  const inputMint = publicKey(input.inputMint);
  const outputMint = publicKey(input.outputMint);
  const inputDecimals = swapAssetDecimals(input.inputSymbol);
  const outputDecimals = swapAssetDecimals(input.outputSymbol);
  const [inputTokenAccount, outputTokenAccount] = await Promise.all([
    readSwapTokenAccount({
      decimals: inputDecimals,
      mint: input.inputMint,
      owner: input.owner,
      rpcUrl: input.rpcUrl,
      signer: input.signer,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    }),
    readSwapTokenAccount({
      decimals: outputDecimals,
      mint: input.outputMint,
      owner: input.owner,
      rpcUrl: input.rpcUrl,
      signer: input.signer,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    }),
  ]);
  assertWrappedSolAccountEmpty(input, inputTokenAccount, outputTokenAccount);

  const response = await postSignedGatewayRequest<SwapBuildResponse>({
    body: {
      amount: input.amountBaseUnits.toString(),
      inputMint: input.inputMint,
      inputSymbol: input.inputSymbol,
      outputMint: input.outputMint,
      outputSymbol: input.outputSymbol,
      taker: input.owner,
    },
    cluster: 'mainnet',
    operation: 'swap.build',
    signer: input.signer,
    timeoutMs: 10_000,
    url: input.swapBuildUrl,
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  });
  const decoded = decodeStablecoinSwapBuildResponse({
    amountBaseUnits: input.amountBaseUnits,
    inputMint,
    inputMintAddress: input.inputMint,
    inputSymbol: input.inputSymbol,
    inputTokenAccount,
    outputMint,
    outputMintAddress: input.outputMint,
    outputSymbol: input.outputSymbol,
    outputTokenAccount,
    owner,
    response,
  });
  const lookupTables = await readVerifiedStablecoinSwapLookupTables({
    mappings: response.addressesByLookupTableAddress,
    rpcUrl: input.rpcUrl,
    signer: input.signer,
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  });
  const rent = await resolveSwapRent({
    decoded,
    input,
    inputTokenAccount,
    outputTokenAccount,
  });
  const previewTransaction = buildTransaction(
    decoded,
    lookupTables,
    owner,
    MAX_COMPUTE_UNITS,
  );
  const [previewFee, solBalanceLamports] = await Promise.all([
    feeForMessage(previewTransaction, input),
    readNativeSolBalance({
      owner: input.owner,
      rpcUrl: input.rpcUrl,
      signer: input.signer,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    }),
  ]);
  const nativeInputLamports = input.inputSymbol === 'SOL'
    ? input.amountBaseUnits
    : 0n;
  assertStablecoinSwapSolFunding(
    previewFee,
    solBalanceLamports,
    rent.total,
    nativeInputLamports,
  );

  const simulation = await signedSolanaRpc<{
    readonly value: { readonly err: unknown; readonly unitsConsumed?: number };
  }>({
    method: 'simulateTransaction',
    params: [
      base64.encode(previewTransaction.serialize()),
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
      'The token-swap preview failed. No transaction was signed.',
      'simulation_failed',
    );
  }

  const computeUnits = Math.min(
    MAX_COMPUTE_UNITS,
    Math.ceil(simulation.value.unitsConsumed * 1.15),
  );
  const transaction = buildTransaction(decoded, lookupTables, owner, computeUnits);
  const feeLamports = feeNumberToBigInt(await feeForMessage(transaction, input));
  assertStablecoinSwapSolFunding(
    feeLamports,
    solBalanceLamports,
    rent.total,
    nativeInputLamports,
  );
  const requiredSolLamports = feeLamports + rent.total + nativeInputLamports;
  const wrapped = wrappedSolSnapshot(
    input,
    inputTokenAccount,
    outputTokenAccount,
  );
  const refundableRentLamports = wrapped.exists
    ? wrapped.lamports
    : rent.temporary;
  const conservativeSolProceeds = input.outputSymbol === 'SOL'
    ? decoded.minimumOutputBaseUnits
    : 0n;

  return {
    amountBaseUnits: input.amountBaseUnits,
    createsTokenAccount:
      decoded.createsInputTokenAccount || decoded.createsOutputTokenAccount,
    estimatedEndingSolLamports:
      solBalanceLamports - requiredSolLamports +
      refundableRentLamports + conservativeSolProceeds,
    expectedOutputBaseUnits: decoded.expectedOutputBaseUnits,
    feeLamports,
    inputDecimals,
    inputMint: input.inputMint,
    inputSymbol: input.inputSymbol,
    inputTokenAccount,
    lastValidBlockHeight: decoded.lastValidBlockHeight,
    minimumOutputBaseUnits: decoded.minimumOutputBaseUnits,
    outputDecimals,
    outputMint: input.outputMint,
    outputSymbol: input.outputSymbol,
    outputTokenAccount,
    persistentRentLamports: rent.persistent,
    refundableRentLamports,
    rentLamports: rent.total,
    reviewedMessage: transaction.message.serialize(),
    requiredSolLamports,
    solBalanceLamports,
    temporaryRentLamports: rent.temporary,
    transaction,
  };
}

export function assertStablecoinSwapTransactionUnchanged(
  plan: StablecoinSwapPlan,
): void {
  if (
    !Buffer.from(plan.transaction.message.serialize()).equals(
      Buffer.from(plan.reviewedMessage),
    )
  ) {
    throw new StablecoinSwapError(
      'The token swap changed after review. Request a fresh quote.',
      'transaction_mismatch',
    );
  }
}

export function assertStablecoinSwapSolFunding(
  feeLamports: number | bigint | null,
  solBalanceLamports: number | bigint,
  rentLamports: number | bigint,
  nativeInputLamports: bigint = 0n,
): asserts feeLamports is number | bigint {
  const fee = safeLamports(feeLamports);
  const balance = safeLamports(solBalanceLamports);
  const rent = safeLamports(rentLamports);
  if (
    fee === null ||
    balance === null ||
    rent === null ||
    nativeInputLamports < 0n ||
    fee > MAX_SWAP_NETWORK_FEE_LAMPORTS
  ) {
    throw new StablecoinSwapError(
      'The network fee could not be verified.',
      'fee_invalid',
    );
  }
  if (balance < fee + rent + nativeInputLamports) {
    throw new StablecoinSwapError(
      nativeInputLamports > 0n
        ? 'The wallet does not have enough SOL for this amount, rent, and fee.'
        : rent > 0n
          ? 'The wallet needs more SOL for token-account rent and the fee.'
          : 'The wallet needs more SOL for the network fee.',
      'insufficient_sol',
    );
  }
}

async function resolveSwapRent(input: {
  readonly decoded: DecodedStablecoinSwapBuild;
  readonly input: PrepareSwapInput;
  readonly inputTokenAccount: SwapTokenAccountSnapshot;
  readonly outputTokenAccount: SwapTokenAccountSnapshot;
}): Promise<{
  readonly persistent: bigint;
  readonly temporary: bigint;
  readonly total: bigint;
}> {
  const createsMissingInput =
    input.decoded.createsInputTokenAccount && !input.inputTokenAccount.exists;
  const createsMissingOutput =
    input.decoded.createsOutputTokenAccount && !input.outputTokenAccount.exists;
  if (!createsMissingInput && !createsMissingOutput) {
    return { persistent: 0n, temporary: 0n, total: 0n };
  }
  const accountRent = await readTokenAccountRent({
    rpcUrl: input.input.rpcUrl,
    signer: input.input.signer,
    ...(input.input.signal === undefined ? {} : { signal: input.input.signal }),
  });
  const temporary =
    (input.input.inputSymbol === 'SOL' && createsMissingInput) ||
    (input.input.outputSymbol === 'SOL' && createsMissingOutput)
      ? accountRent
      : 0n;
  const persistent =
    (input.input.inputSymbol === 'USDC' && createsMissingInput) ||
    (input.input.outputSymbol === 'USDC' && createsMissingOutput)
      ? accountRent
      : 0n;
  return { persistent, temporary, total: persistent + temporary };
}

function buildTransaction(
  build: DecodedStablecoinSwapBuild,
  lookupTables: readonly AddressLookupTableAccount[],
  owner: PublicKey,
  computeUnits: number,
): VersionedTransaction {
  const message = new TransactionMessage({
    instructions: [
      ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnits }),
      ...build.instructions,
    ],
    payerKey: owner,
    recentBlockhash: build.blockhash,
  }).compileToV0Message([...lookupTables]);
  return new VersionedTransaction(message);
}

async function feeForMessage(
  transaction: VersionedTransaction,
  input: Pick<PrepareSwapInput, 'rpcUrl' | 'signal' | 'signer'>,
): Promise<number | null> {
  const fee = await signedSolanaRpc<{ readonly value: number | null }>({
    method: 'getFeeForMessage',
    params: [
      base64.encode(transaction.message.serialize()),
      { commitment: 'confirmed' },
    ],
    rpcUrl: input.rpcUrl,
    signer: input.signer,
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  });
  return fee.value;
}

function validateSwapIntent(input: PrepareSwapInput): void {
  const nativeMint = NATIVE_MINT.toBase58();
  if (
    input.amountBaseUnits <= 0n ||
    input.inputSymbol === input.outputSymbol ||
    input.inputMint === input.outputMint ||
    (input.inputSymbol === 'SOL') !== (input.inputMint === nativeMint) ||
    (input.outputSymbol === 'SOL') !== (input.outputMint === nativeMint)
  ) {
    throw invalidPlan();
  }
}

function assertWrappedSolAccountEmpty(
  input: PrepareSwapInput,
  inputAccount: SwapTokenAccountSnapshot,
  outputAccount: SwapTokenAccountSnapshot,
): void {
  const wrapped = wrappedSolSnapshot(input, inputAccount, outputAccount);
  if (wrapped.amountBaseUnits !== 0n) {
    throw new StablecoinSwapError(
      'Unwrap the existing WSOL balance before using native SOL swap.',
      'wsol_balance_present',
    );
  }
}

function wrappedSolSnapshot(
  input: PrepareSwapInput,
  inputAccount: SwapTokenAccountSnapshot,
  outputAccount: SwapTokenAccountSnapshot,
): SwapTokenAccountSnapshot {
  return input.inputSymbol === 'SOL' ? inputAccount : outputAccount;
}

function publicKey(value: string): PublicKey {
  try {
    return new PublicKey(value);
  } catch {
    throw invalidPlan();
  }
}

function feeNumberToBigInt(value: number | null): bigint {
  const fee = safeLamports(value);
  if (fee === null) {
    throw new StablecoinSwapError(
      'The network fee could not be verified.',
      'fee_invalid',
    );
  }
  return fee;
}

function safeLamports(value: number | bigint | null): bigint | null {
  if (typeof value === 'bigint') return value >= 0n ? value : null;
  return value !== null && Number.isSafeInteger(value) && value >= 0
    ? BigInt(value)
    : null;
}

function invalidPlan(): StablecoinSwapError {
  return new StablecoinSwapError(
    'The token swap does not match the confirmed intent.',
    'plan_invalid',
  );
}
