export class TradingWalletRotationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TradingWalletRotationError';
  }
}

export type TradingWalletRotationPlan = {
  readonly destinationGeneration: number;
  readonly destinationRentLamports: bigint;
  readonly estimatedFeeLamports: bigint;
  readonly expiresAtMs: number;
  readonly nextWalletAddress: string;
  readonly recoverableRentLamports: bigint;
  readonly sourceSolLamports: bigint;
  readonly sourceWalletAddress: string;
  readonly tokenAccountCount: number;
  readonly tokenMintCount: number;
};
