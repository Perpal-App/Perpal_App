import {
  amountFromBaseUnits,
  type Amount,
  type TokenDecimals,
} from '@/domain/money/amount';
import { pacificaGet } from '@/integrations/perps/pacifica/pacificaApi';

const PRICE_DECIMALS = 10 as const;
const USD_DECIMALS = 10 as const;
const STALE_AFTER_MS = 30_000;
const ICON_ALIASES: Readonly<Record<string, string>> = {
  GOLD: 'XAU',
  SILVER: 'XAG',
};

export type PacificaMarket = {
  readonly symbol: `${string}-PERP`;
  readonly baseAsset: string;
  readonly displayName: string;
  readonly maxLeverage: number;
  readonly venueRef: string;
  readonly iconUrl: string;
  readonly tickSize: string;
  readonly lotSize: string;
  readonly minOrderSize: string;
  readonly maxOrderSize: string;
  readonly isolatedOnly: boolean;
};

export type PacificaMarketSnapshot = {
  readonly venueRef: string;
  readonly price: Amount;
  readonly oraclePrice: Amount;
  readonly priceStale: boolean;
  readonly pricePublishedAtMs: number;
  readonly change24hBps: number;
  readonly volume24h: Amount;
  readonly openInterest: Amount;
  readonly fundingRate: string;
  readonly nextFundingRate: string;
};

export type PacificaMarketBundle = {
  readonly markets: readonly PacificaMarket[];
  readonly snapshots: readonly PacificaMarketSnapshot[];
};

export async function fetchPacificaMarketBundle(
  apiOrigin: string,
  assetOrigin: string,
  signal?: AbortSignal,
): Promise<PacificaMarketBundle> {
  const [rawMarkets, rawPrices] = await Promise.all([
    pacificaGet<readonly unknown[]>({ apiOrigin, path: '/info', signal }),
    pacificaGet<readonly unknown[]>({ apiOrigin, path: '/info/prices', signal }),
  ]);
  return {
    markets: parseMarkets(rawMarkets, assetOrigin),
    snapshots: parsePacificaPrices(rawPrices),
  };
}

export function parsePacificaPrices(value: unknown): readonly PacificaMarketSnapshot[] {
  if (!Array.isArray(value)) throw invalid('price catalog');
  return value.map((entry) => {
    const price = object(entry, 'price');
    const symbol = text(price.symbol, 'symbol');
    const mark = decimal(price.mark, PRICE_DECIMALS, 'mark');
    const yesterday = decimal(price.yesterday_price, PRICE_DECIMALS, 'yesterday price');
    const published = timestamp(price.timestamp);
    const change = yesterday.baseUnits === 0n
      ? 0n
      : ((mark.baseUnits - yesterday.baseUnits) * 10_000n) / yesterday.baseUnits;
    const change24hBps = clampSafeNumber(change);
    return {
      venueRef: symbol,
      price: mark,
      oraclePrice: decimal(price.oracle, PRICE_DECIMALS, 'oracle price'),
      priceStale: Date.now() - published > STALE_AFTER_MS,
      pricePublishedAtMs: published,
      change24hBps,
      volume24h: decimal(price.volume_24h, USD_DECIMALS, '24 hour volume'),
      openInterest: decimal(price.open_interest, USD_DECIMALS, 'open interest'),
      fundingRate: decimalText(price.funding, 'funding rate'),
      nextFundingRate: decimalText(price.next_funding, 'next funding rate'),
    } satisfies PacificaMarketSnapshot;
  });
}

export function parsePacificaPriceMessage(value: unknown): readonly PacificaMarketSnapshot[] | null {
  const message = object(value, 'WebSocket message');
  return message.channel === 'prices' ? parsePacificaPrices(message.data) : null;
}

export function formatPacificaRatePercent(value: string): string {
  const negative = value.startsWith('-');
  const unsigned = negative ? value.slice(1) : value;
  const [whole = '0', fraction = ''] = unsigned.split('.');
  const divisor = 10n ** BigInt(fraction.length);
  const magnitude = BigInt(`${whole}${fraction}`);
  const tenThousandths = (magnitude * 1_000_000n + divisor / 2n) / divisor;
  const digits = tenThousandths.toString().padStart(5, '0');
  const sign = tenThousandths === 0n ? '' : negative ? '-' : '+';
  return `${sign}${digits.slice(0, -4)}.${digits.slice(-4)}%`;
}

function parseMarkets(value: unknown, assetOrigin: string): readonly PacificaMarket[] {
  if (!Array.isArray(value)) throw invalid('market catalog');
  return value.map((entry) => {
    const market = object(entry, 'market');
    const venueRef = text(market.symbol, 'market symbol');
    const baseAsset = text(market.base_asset, 'base asset');
    const maxLeverage = integer(market.max_leverage, 'maximum leverage');
    if (maxLeverage < 1) throw invalid('maximum leverage');
    return {
      symbol: `${baseAsset}-PERP`,
      baseAsset,
      displayName: baseAsset,
      maxLeverage,
      venueRef,
      iconUrl: `${assetOrigin}/imgs/tokens/${encodeURIComponent(ICON_ALIASES[baseAsset] ?? baseAsset)}.svg`,
      tickSize: decimalText(market.tick_size, 'tick size'),
      lotSize: decimalText(market.lot_size, 'lot size'),
      minOrderSize: decimalText(market.min_order_size, 'minimum order size'),
      maxOrderSize: decimalText(market.max_order_size, 'maximum order size'),
      isolatedOnly: boolean(market.isolated_only, 'isolated flag'),
    } as PacificaMarket;
  });
}

function decimal(value: unknown, decimals: TokenDecimals, label: string): Amount {
  const raw = decimalText(value, label);
  const negative = raw.startsWith('-');
  const unsigned = negative ? raw.slice(1) : raw;
  const [whole = '0', fraction = ''] = unsigned.split('.');
  if (fraction.length > decimals) throw invalid(label);
  const baseUnits = BigInt(`${whole}${fraction.padEnd(decimals, '0')}`);
  return amountFromBaseUnits(negative ? -baseUnits : baseUnits, decimals);
}

function decimalText(value: unknown, label: string): string {
  const raw = typeof value === 'number' && Number.isFinite(value) ? String(value) : value;
  if (typeof raw !== 'string' || !/^-?\d+(?:\.\d+)?$/u.test(raw)) throw invalid(label);
  return raw;
}

function timestamp(value: unknown): number {
  const parsed = typeof value === 'string' ? Number(value) : value;
  if (typeof parsed !== 'number' || !Number.isSafeInteger(parsed) || parsed <= 0) {
    throw invalid('timestamp');
  }
  return parsed < 10_000_000_000 ? parsed * 1_000 : parsed;
}

function integer(value: unknown, label: string): number {
  const parsed = typeof value === 'string' ? Number(value) : value;
  if (typeof parsed !== 'number' || !Number.isSafeInteger(parsed)) throw invalid(label);
  return parsed;
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw invalid(label);
  return value;
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) throw invalid(label);
  return value;
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw invalid(label);
  return value as Record<string, unknown>;
}

function clampSafeNumber(value: bigint): number {
  const maximum = BigInt(Number.MAX_SAFE_INTEGER);
  if (value > maximum || value < -maximum) throw invalid('24 hour change');
  return Number(value);
}

function invalid(label: string): Error {
  return new Error(`Pacifica returned an invalid ${label}.`);
}
