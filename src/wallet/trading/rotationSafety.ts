import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token';

import type { AppConfig } from '@/config/appConfig';
import type { GatewayRequestSigner } from '@/integrations/api/gatewayClient';
import { signedSolanaRpc } from '@/integrations/api/signedSolanaRpc';
import { fetchPacificaPortfolio } from '@/integrations/perps/pacifica/pacificaPortfolio';
import { hasPendingPacificaWithdrawal } from '@/integrations/perps/pacifica/pacificaWithdrawal';
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
  readonly mainWalletAddress: string;
  readonly signer: GatewayRequestSigner;
  readonly tradingWalletAddress: string;
}): Promise<void> {
  const [
    nativeBalance,
    tokenBalance,
    token2022Balance,
    funding,
    exit,
    pacificaWithdrawal,
    pacifica,
  ] = await Promise.all([
    solBalance(input.tradingWalletAddress, input),
    totalTokenBalance(TOKEN_PROGRAM_ID.toBase58(), input),
    totalTokenBalance(TOKEN_2022_PROGRAM_ID.toBase58(), input),
    readPrivateFundingRecord(input.mainWalletAddress),
    readPrivateExitRecord(input.tradingWalletAddress),
    hasPendingPacificaWithdrawal(input.tradingWalletAddress),
    fetchPacificaPortfolio(
      input.config.perps.pacificaApiOrigin,
      input.tradingWalletAddress,
    ),
  ]);

  if (nativeBalance !== 0n) {
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
  if (pacificaWithdrawal) {
    throw new TradingWalletRotationError('A Pacifica withdrawal is still pending.');
  }
  if (
    pacifica.positions.length > 0 ||
    pacifica.orders.length > 0 ||
    nonZero(pacifica.balance) ||
    nonZero(pacifica.pendingBalance)
  ) {
    throw new TradingWalletRotationError('Pacifica still holds positions, orders, collateral, or a pending balance.');
  }
}

function nonZero(value: string): boolean {
  return !/^0+(?:\.0+)?$/u.test(value);
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
