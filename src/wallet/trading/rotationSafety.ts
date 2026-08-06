import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { base58 } from '@scure/base';

import type { AppConfig } from '@/config/appConfig';
import type { GatewayRequestSigner } from '@/integrations/api/gatewayClient';
import { signedSolanaRpc } from '@/integrations/api/signedSolanaRpc';
import { fetchFlashPortfolio } from '@/integrations/perps/flash/flashPortfolio';
import { readPendingFlashSettlements } from '@/integrations/perps/flash/flashSettlementStorage';
import { listMainnetMarkets } from '@/integrations/perps/markets/mainnetCatalog';
import { fetchPublicMarketPrices } from '@/integrations/perps/markets/publicMarketData';
import { fetchVelocityPortfolio } from '@/integrations/perps/velocity/velocityPortfolio';
import { readPendingVelocitySettlements } from '@/integrations/perps/velocity/velocitySettlementStorage';
import { readPrivateExitRecord } from '@/integrations/umbra/privateExitStorage';
import { readPrivateFundingRecord } from '@/integrations/umbra/umbraSecureStorage';

export class TradingWalletRotationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TradingWalletRotationError';
  }
}

export async function assertTradingWalletRotationSafe(input: {
  readonly config: AppConfig;
  readonly feeSigner: GatewayRequestSigner;
  readonly mainWalletAddress: string;
  readonly signer: GatewayRequestSigner;
  readonly tradingWalletAddress: string;
}): Promise<void> {
  const controller = new AbortController();
  const [
    nativeBalance,
    feeSignerBalance,
    tokenBalance,
    token2022Balance,
    funding,
    exit,
    velocityPending,
    flashPending,
    prices,
    flash,
  ] = await Promise.all([
    solBalance(input.tradingWalletAddress, input),
    solBalance(base58.encode(input.feeSigner.publicKey), input),
    totalTokenBalance(TOKEN_PROGRAM_ID.toBase58(), input),
    totalTokenBalance(TOKEN_2022_PROGRAM_ID.toBase58(), input),
    readPrivateFundingRecord(input.mainWalletAddress),
    readPrivateExitRecord(input.tradingWalletAddress),
    readPendingVelocitySettlements(input.tradingWalletAddress),
    readPendingFlashSettlements(input.tradingWalletAddress),
    fetchPublicMarketPrices(input.config.api.marketDataUrl, controller.signal),
    fetchFlashPortfolio(
      input.config.perps.flashErRpc,
      input.config.perps.flashProgramId,
      input.tradingWalletAddress,
      controller.signal,
    ),
  ]);
  const velocity = await fetchVelocityPortfolio(
    input.config.api.publicRpcUrl,
    input.config.perps.velocityProgramId,
    input.tradingWalletAddress,
    listMainnetMarkets('velocity'),
    prices,
    controller.signal,
  );

  if (nativeBalance !== 0n || feeSignerBalance !== 0n) {
    throw new TradingWalletRotationError('Withdraw the remaining private SOL fee reserve first.');
  }
  if (tokenBalance !== 0n || token2022Balance !== 0n) {
    throw new TradingWalletRotationError('Withdraw every token balance from T first.');
  }
  if (funding !== null && funding.phase !== 'complete') {
    throw new TradingWalletRotationError('Private funding is still pending.');
  }
  if (exit !== null && exit.phase !== 'complete') {
    throw new TradingWalletRotationError('A private withdrawal is still pending.');
  }
  if (velocityPending.length > 0 || flashPending.length > 0) {
    throw new TradingWalletRotationError('A provider settlement is still pending.');
  }
  if (
    flash.positions.length > 0 ||
    flash.openOrders > 0 ||
    Object.values(flash.deposits).some((amount) => amount.baseUnits !== 0n) ||
    Object.values(flash.reservedWithdrawals).some((amount) => amount.baseUnits !== 0n)
  ) {
    throw new TradingWalletRotationError('Flash still holds positions, orders, or collateral.');
  }
  if (
    velocity.positions.length > 0 ||
    velocity.openOrders > 0 ||
    velocity.nonCorePositionCount > 0 ||
    velocity.unsupportedSpotPositionCount > 0 ||
    (velocity.initialized &&
      (velocity.margin === null || velocity.margin.totalCollateral.baseUnits !== 0n))
  ) {
    throw new TradingWalletRotationError('Velocity still holds positions, orders, or collateral.');
  }
}

async function solBalance(
  address: string,
  input: { readonly config: AppConfig; readonly signer: GatewayRequestSigner },
): Promise<bigint> {
  const result = await signedSolanaRpc<{ readonly value: number }>({
    method: 'getBalance',
    params: [address, { commitment: 'confirmed' }],
    rpcUrl: input.config.api.rpcUrl,
    signer: input.signer,
  });
  if (!Number.isSafeInteger(result.value) || result.value < 0) {
    throw new TradingWalletRotationError('A wallet balance could not be verified.');
  }
  return BigInt(result.value);
}

async function totalTokenBalance(
  programId: string,
  input: {
    readonly config: AppConfig;
    readonly signer: GatewayRequestSigner;
    readonly tradingWalletAddress: string;
  },
): Promise<bigint> {
  const result = await signedSolanaRpc<{
    readonly value: readonly { readonly account: { readonly data: unknown } }[];
  }>({
    method: 'getTokenAccountsByOwner',
    params: [
      input.tradingWalletAddress,
      { programId },
      { commitment: 'confirmed', encoding: 'jsonParsed' },
    ],
    rpcUrl: input.config.api.rpcUrl,
    signer: input.signer,
  });
  return result.value.reduce((total, entry) => total + parsedTokenAmount(entry.account.data), 0n);
}

function parsedTokenAmount(value: unknown): bigint {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw invalidToken();
  const parsed = (value as Record<string, unknown>).parsed;
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw invalidToken();
  const info = (parsed as Record<string, unknown>).info;
  if (typeof info !== 'object' || info === null || Array.isArray(info)) throw invalidToken();
  const tokenAmount = (info as Record<string, unknown>).tokenAmount;
  if (typeof tokenAmount !== 'object' || tokenAmount === null || Array.isArray(tokenAmount)) {
    throw invalidToken();
  }
  const amount = (tokenAmount as Record<string, unknown>).amount;
  if (typeof amount !== 'string' || !/^\d+$/u.test(amount)) throw invalidToken();
  return BigInt(amount);
}

function invalidToken() {
  return new TradingWalletRotationError('A token balance could not be verified.');
}
