import { CustomBorshAccountsCoder } from '@drift-labs/sdk/lib/browser/decode/customCoder';
import driftIdl from '@drift-labs/sdk/lib/browser/idl/drift.json';
import { getPerpMarketPublicKeySync } from '@drift-labs/sdk/lib/browser/addresses/pda';
import { calculateFormattedLiveFundingRate } from '@drift-labs/sdk/lib/browser/math/funding';
import {
  calculateAskPrice,
  calculateBidPrice,
  calculateReservePrice,
} from '@drift-labs/sdk/lib/browser/math/market';
import type { MMOraclePriceData } from '@drift-labs/sdk/lib/browser/oracles/types';
import type { PerpMarketAccount } from '@drift-labs/sdk/lib/browser/types';
import { PublicKey } from '@solana/web3.js';

import { amountFromBaseUnits, type Amount } from '@/domain/money/amount';
import { fetchPublicProgramAccounts } from '@/integrations/api/publicSolanaRpc';
import type { MainnetMarket } from '@/integrations/perps/markets/mainnetCatalog';
import type { PublicMarketPrice } from '@/integrations/perps/markets/publicMarketData';

const coder = new CustomBorshAccountsCoder<'PerpMarket'>(
  driftIdl as unknown as ConstructorParameters<
    typeof CustomBorshAccountsCoder
  >[0],
);

type DriftBn = PerpMarketAccount['amm']['pegMultiplier'];

export type DriftMarketSnapshot = {
  readonly symbol: MainnetMarket['symbol'];
  readonly markPrice: Amount;
  readonly bidPrice: Amount;
  readonly askPrice: Amount;
  readonly volume24h: Amount;
  readonly initialMarginBps: number;
  readonly fundingLabel: string | null;
  readonly slot: number;
};

export async function fetchDriftMarketSnapshots(
  rpcUrl: string,
  programId: string,
  markets: readonly MainnetMarket[],
  prices: readonly PublicMarketPrice[],
  signal: AbortSignal,
): Promise<readonly DriftMarketSnapshot[]> {
  const driftProgram = new PublicKey(programId);
  const indexes = markets.map(readMarketIndex);
  const addresses = indexes.map((index) =>
    getPerpMarketPublicKeySync(driftProgram, index),
  );
  const response = await fetchPublicProgramAccounts(
    rpcUrl,
    addresses.map((address) => address.toBase58()),
    programId,
    signal,
  );
  const pricesBySymbol = new Map(prices.map((price) => [price.symbol, price]));

  return markets.map((market, position) => {
    const data = response.accounts[position];
    const address = addresses[position];
    const index = indexes[position];
    const price = pricesBySymbol.get(market.symbol);

    if (data === undefined || address === undefined || index === undefined) {
      throw new Error('Drift returned an incomplete market account set.');
    }

    if (price === undefined || price.stale) {
      throw new Error('Drift venue data requires a current Pyth price.');
    }

    const decoded = coder.decode<PerpMarketAccount>('PerpMarket', data);

    if (decoded.marketIndex !== index) {
      throw new Error('Drift returned a mismatched market account.');
    }

    const account = { ...decoded, pubkey: address };
    const oracle = oracleData(account, price, response.slot);
    const latestSlot = driftBn(account, response.slot.toString());

    return {
      symbol: market.symbol,
      markPrice: priceAmount(calculateReservePrice(account, oracle)),
      bidPrice: priceAmount(calculateBidPrice(account, oracle, latestSlot)),
      askPrice: priceAmount(calculateAskPrice(account, oracle, latestSlot)),
      volume24h: priceAmount(account.amm.volume24H),
      initialMarginBps: account.marginRatioInitial,
      fundingLabel: fundingLabel(account, oracle),
      slot: response.slot,
    };
  });
}

function readMarketIndex(market: MainnetMarket): number {
  const index = Number(market.venueRef);

  if (!Number.isSafeInteger(index) || index < 0) {
    throw new Error(`Drift market ${market.symbol} has an invalid index.`);
  }

  return index;
}

function oracleData(
  market: PerpMarketAccount,
  price: PublicMarketPrice,
  slot: number,
): MMOraclePriceData {
  return {
    price: driftBn(market, toSixDecimals(price.price).toString()),
    confidence: driftBn(market, toSixDecimals(price.confidence).toString()),
    slot: driftBn(market, slot.toString()),
    hasSufficientNumberOfDataPoints: true,
    isMMOracleActive: !market.amm.mmOracleSlot.isZero(),
  };
}

function fundingLabel(
  market: PerpMarketAccount,
  oracle: MMOraclePriceData,
): string | null {
  try {
    const funding = calculateFormattedLiveFundingRate(
      market,
      oracle,
      oracle,
      'hour',
    );
    const rate = funding.longRate;

    if (rate === 0) {
      return '0.00000%';
    }

    return `Longs ${rate < 0 ? 'pay' : 'receive'} ${Math.abs(rate).toFixed(5)}%`;
  } catch {
    return null;
  }
}

function driftBn(market: PerpMarketAccount, value: string): DriftBn {
  const Constructor = market.amm.pegMultiplier.constructor as unknown as new (
    input: string,
  ) => DriftBn;

  return new Constructor(value);
}

function priceAmount(value: DriftBn): Amount {
  return amountFromBaseUnits(BigInt(value.toString()), 6);
}

function toSixDecimals(amount: Amount): bigint {
  if (amount.decimals === 6) {
    return amount.baseUnits;
  }

  return amount.baseUnits / 10n ** BigInt(amount.decimals - 6);
}
