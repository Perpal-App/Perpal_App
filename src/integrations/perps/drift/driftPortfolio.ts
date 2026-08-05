import { getUserAccountPublicKeySync } from '@drift-labs/sdk/lib/browser/addresses/pda';
import { decodeUser } from '@drift-labs/sdk/lib/browser/decode/user';
import { PublicKey } from '@solana/web3.js';

import { amountFromBaseUnits, type Amount } from '@/domain/money/amount';
import { fetchPublicProgramAccount } from '@/integrations/api/publicSolanaRpc';
import type { MainnetMarket } from '@/integrations/perps/markets/mainnetCatalog';
import type { PublicMarketPrice } from '@/integrations/perps/markets/publicMarketData';

export type DriftPortfolioPosition = {
  readonly symbol: MainnetMarket['symbol'];
  readonly side: 'Long' | 'Short';
  readonly size: Amount;
  readonly entryPrice: Amount | null;
  readonly unrealizedPnl: Amount | null;
  readonly openOrders: number;
};

export type DriftPortfolioSnapshot = {
  readonly initialized: boolean;
  readonly accountAddress: string;
  readonly positions: readonly DriftPortfolioPosition[];
  readonly openOrders: number;
  readonly unsupportedPositionCount: number;
  readonly slot: number;
};

export async function fetchDriftPortfolio(
  rpcUrl: string,
  programId: string,
  walletAddress: string,
  markets: readonly MainnetMarket[],
  prices: readonly PublicMarketPrice[],
  signal: AbortSignal,
): Promise<DriftPortfolioSnapshot> {
  const program = new PublicKey(programId);
  const authority = new PublicKey(walletAddress);
  const userAddress = getUserAccountPublicKeySync(program, authority);
  const response = await fetchPublicProgramAccount(
    rpcUrl,
    userAddress.toBase58(),
    programId,
    signal,
  );

  if (response.account === null) {
    return emptySnapshot(userAddress, response.slot);
  }

  const user = decodeUser(response.account);

  if (!user.authority.equals(authority)) {
    throw new Error('Drift returned a user account for another authority.');
  }

  const marketsByIndex = new Map(
    markets.map((market) => [Number(market.venueRef), market]),
  );
  const pricesBySymbol = new Map(prices.map((price) => [price.symbol, price]));
  let unsupportedPositionCount = 0;
  const positions: DriftPortfolioPosition[] = [];

  for (const position of user.perpPositions) {
    const baseAssetAmount = BigInt(position.baseAssetAmount.toString());
    const market = marketsByIndex.get(position.marketIndex);

    if (market === undefined) {
      unsupportedPositionCount += 1;
      continue;
    }

    const price = pricesBySymbol.get(market.symbol);
    const quoteEntryAmount = BigInt(position.quoteEntryAmount.toString());

    positions.push({
      symbol: market.symbol,
      side: baseAssetAmount < 0n ? 'Short' : 'Long',
      size: amountFromBaseUnits(abs(baseAssetAmount), 9),
      entryPrice: entryPrice(baseAssetAmount, quoteEntryAmount),
      unrealizedPnl:
        price === undefined || price.stale
          ? null
          : amountFromBaseUnits(
              BigInt(position.quoteAssetAmount.toString()) +
                baseValueInQuoteUnits(baseAssetAmount, price.price),
              6,
            ),
      openOrders: position.openOrders,
    });
  }

  return {
    initialized: true,
    accountAddress: userAddress.toBase58(),
    positions,
    openOrders: user.openOrders,
    unsupportedPositionCount,
    slot: response.slot,
  };
}

function emptySnapshot(
  userAddress: PublicKey,
  slot: number,
): DriftPortfolioSnapshot {
  return {
    initialized: false,
    accountAddress: userAddress.toBase58(),
    positions: [],
    openOrders: 0,
    unsupportedPositionCount: 0,
    slot,
  };
}

function entryPrice(baseAssetAmount: bigint, quoteEntryAmount: bigint): Amount | null {
  const base = abs(baseAssetAmount);

  if (base === 0n) {
    return null;
  }

  return amountFromBaseUnits((abs(quoteEntryAmount) * 1_000_000_000n) / base, 6);
}

function baseValueInQuoteUnits(baseAssetAmount: bigint, price: Amount): bigint {
  const divisor = 10n ** BigInt(9 + price.decimals - 6);
  return (baseAssetAmount * price.baseUnits) / divisor;
}

function abs(value: bigint): bigint {
  return value < 0n ? -value : value;
}
