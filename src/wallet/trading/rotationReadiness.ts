import type { AppConfig } from '@/config/appConfig';
import type { GatewayRequestSigner } from '@/integrations/api/gatewayClient';
import { fetchFreshPacificaPortfolio } from '@/integrations/perps/pacifica/pacificaPortfolio';
import { hasPendingPacificaWithdrawal } from '@/integrations/perps/pacifica/pacificaWithdrawal';
import { readPendingTradeAction } from '@/integrations/perps/tradeActionStorage';
import { readPrivateExitRecord } from '@/integrations/umbra/privateExitStorage';
import { readPrivateFundingRecord } from '@/integrations/umbra/umbraSecureStorage';
import { readTradingWalletRotation } from '@/storage/trading-wallet-rotation';
import { readRotatableTokenAccounts } from '@/wallet/trading/rotationAccounts';
import { TradingWalletRotationError } from '@/wallet/trading/rotationTypes';
import { signedSolanaRpc } from '@/integrations/api/signedSolanaRpc';

export type RotationReadinessInput = {
  readonly config: AppConfig;
  readonly mainWalletAddress: string;
  readonly signer: GatewayRequestSigner;
  readonly tradingWalletAddress: string;
};

export async function assertNoPendingRotationActivity(
  input: RotationReadinessInput,
  allowRotationCheckpoint: boolean,
): Promise<void> {
  const [funding, exit, directExit, pacificaWithdrawal, pacifica, pacificaAction, rotation] =
    await Promise.all([
      readPrivateFundingRecord(input.mainWalletAddress),
      readPrivateExitRecord(input.tradingWalletAddress),
      readPendingTradeAction(input.tradingWalletAddress, 'wallet-withdrawal'),
      hasPendingPacificaWithdrawal(input.tradingWalletAddress),
      fetchFreshPacificaPortfolio(
        input.config.perps.pacificaApiOrigin,
        input.tradingWalletAddress,
      ),
      readPendingTradeAction(input.tradingWalletAddress, 'pacifica'),
      readTradingWalletRotation(input.mainWalletAddress),
    ]);
  if (funding !== null && funding.phase !== 'complete') fail('Private funding is still pending.');
  if (exit !== null && exit.phase !== 'complete') fail('A private withdrawal is still pending.');
  if (directExit !== null) fail('A direct withdrawal is still pending confirmation.');
  if (pacificaWithdrawal) fail('A Pacifica withdrawal is still pending.');
  if (pacificaAction !== null) fail('A trading transaction is still pending confirmation.');
  if (rotation !== null && !allowRotationCheckpoint) fail('A private-wallet rotation is already pending.');
  if (
    pacifica.positionsCount > 0 || pacifica.ordersCount > 0 ||
    pacifica.stopOrdersCount > 0 || nonZero(pacifica.balance) ||
    nonZero(pacifica.pendingBalance)
  ) fail('Pacifica still holds positions, orders, collateral, or a pending balance.');
}

/** A recorded identity may only be replaced after every fund and operation surface is empty. */
export async function assertTradingWalletIdentityRetired(
  input: RotationReadinessInput & { readonly candidateWalletAddress: string },
): Promise<void> {
  await assertNoPendingRotationActivity(input, false);
  const rpc = { rpcUrl: input.config.api.rpcUrl, signer: input.signer };
  const [sol, tokens] = await Promise.all([
    readSolBalance(input.tradingWalletAddress, input),
    readRotatableTokenAccounts(
      input.tradingWalletAddress,
      input.candidateWalletAddress,
      rpc,
    ),
  ]);
  if (sol !== 0n || tokens.length !== 0) {
    throw new TradingWalletRotationError(
      'The recorded private wallet still holds assets. Its identity was preserved; recover or empty it before adopting another wallet.',
    );
  }
}

async function readSolBalance(
  address: string,
  input: RotationReadinessInput,
): Promise<bigint> {
  const result = await signedSolanaRpc<{ readonly value: number }>({
    method: 'getBalance',
    params: [address, { commitment: 'confirmed' }],
    rpcUrl: input.config.api.rpcUrl,
    signer: input.signer,
  });
  if (!Number.isSafeInteger(result.value) || result.value < 0) {
    throw new TradingWalletRotationError('A private-wallet SOL balance could not be verified.');
  }
  return BigInt(result.value);
}

function nonZero(value: string): boolean {
  return !/^0+(?:\.0+)?$/u.test(value);
}

function fail(message: string): never {
  throw new TradingWalletRotationError(message);
}
