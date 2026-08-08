export type TokenHolding = {
  readonly baseUnits: bigint;
  readonly decimals: number;
  readonly mint: string;
};

export type TokenPriceMap = ReadonlyMap<string, string>;

const PRICE_DECIMALS = 18;
const USD_DECIMALS = 6;
const USD_ROUNDING_FACTOR = 10n ** BigInt(PRICE_DECIMALS - USD_DECIMALS);

/** Values every priced holding with integer arithmetic and reports missing prices separately. */
export function valueTokenHoldingsUsd(
  holdings: readonly TokenHolding[],
  prices: TokenPriceMap,
): { readonly unpricedAssetCount: number; readonly usdBaseUnits: bigint } {
  let totalAtPriceScale = 0n;
  let unpricedAssetCount = 0;

  for (const holding of holdings) {
    if (holding.baseUnits <= 0n) continue;

    const price = prices.get(holding.mint);
    const priceBaseUnits = price === undefined ? null : parsePrice(price);

    if (priceBaseUnits === null) {
      unpricedAssetCount += 1;
      continue;
    }

    totalAtPriceScale +=
      (holding.baseUnits * priceBaseUnits) /
      10n ** BigInt(holding.decimals);
  }

  return {
    unpricedAssetCount,
    usdBaseUnits:
      (totalAtPriceScale + USD_ROUNDING_FACTOR / 2n) / USD_ROUNDING_FACTOR,
  };
}

function parsePrice(value: string): bigint | null {
  if (!/^\d+(?:\.\d{1,18})?$/u.test(value)) return null;

  const [whole = '0', fraction = ''] = value.split('.');
  const result = BigInt(`${whole}${fraction.padEnd(PRICE_DECIMALS, '0')}`);
  return result > 0n ? result : null;
}
