import type { VersionedTransaction } from '@solana/web3.js';

export type SwapAsset = 'SOL' | 'USDC';
export type SwapAssetSymbol = SwapAsset;
export type SwapAmountMode = 'exact' | 'max';

export type StablecoinSwapInstructionErrorCode =
  | 'swap_cleanup_instruction_invalid'
  | 'swap_compute_instruction_invalid'
  | 'swap_route_instruction_invalid'
  | 'swap_setup_instruction_invalid';

export const SWAP_ASSET_DECIMALS: Readonly<Record<SwapAsset, 6 | 9>> = {
  SOL: 9,
  USDC: 6,
};

export function swapAssetDecimals(asset: SwapAsset): 6 | 9 {
  return SWAP_ASSET_DECIMALS[asset];
}

export type SwapTokenAccountSnapshot = {
  readonly address: string;
  readonly amountBaseUnits: bigint;
  readonly exists: boolean;
  readonly lamports: bigint;
};

export type StablecoinSwapPlan = {
  readonly amountBaseUnits: bigint;
  readonly createsTokenAccount: boolean;
  readonly expectedOutputBaseUnits: bigint;
  readonly estimatedEndingSolLamports: bigint;
  readonly feeLamports: bigint;
  readonly inputDecimals: number;
  readonly inputMint: string;
  readonly inputSymbol: SwapAssetSymbol;
  readonly inputTokenAccount: SwapTokenAccountSnapshot;
  readonly lastValidBlockHeight: number;
  readonly minimumOutputBaseUnits: bigint;
  readonly outputDecimals: number;
  readonly outputMint: string;
  readonly outputSymbol: SwapAssetSymbol;
  readonly outputTokenAccount: SwapTokenAccountSnapshot;
  readonly persistentRentLamports: bigint;
  readonly refundableRentLamports: bigint;
  /** Rent that must be available before execution, including temporary WSOL rent. */
  readonly rentLamports: bigint;
  readonly reviewedMessage: Uint8Array;
  /** Native SOL needed at signing time, including SOL sold when SOL is the input. */
  readonly requiredSolLamports: bigint;
  readonly solBalanceLamports: bigint;
  readonly temporaryRentLamports: bigint;
  readonly transaction: VersionedTransaction;
};

export class StablecoinSwapError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = 'StablecoinSwapError';
  }
}

export class StablecoinSwapInstructionValidationError extends Error {
  constructor(readonly code: StablecoinSwapInstructionErrorCode) {
    super('The token-swap instructions could not be verified. Request a fresh quote.');
    this.name = 'StablecoinSwapInstructionValidationError';
  }
}
