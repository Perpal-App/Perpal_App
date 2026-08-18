import { Buffer } from 'buffer';
import { Connection, PublicKey } from '@solana/web3.js';
import { initialize } from '@velocity-exchange/sdk/lib/browser/config';
import { MainnetPerpMarkets } from '@velocity-exchange/sdk/lib/browser/constants/perpMarkets';
import { VelocityCore } from '@velocity-exchange/sdk/lib/browser/core/VelocityCore';

import { amountFromBaseUnits, type Amount } from '@/domain/money/amount';

const PRICE_DECIMALS = 6 as const;
const QUOTE_DECIMALS = 6 as const;
const BASE_PRECISION = 1_000_000_000n;
const MARGIN_PRECISION = 10_000;
const POLL_INTERVAL_MS = 1_000;

export type VelocityMarket = {
  readonly baseAsset: string;
  readonly displayName: string;
  readonly iconUrl: string;
  readonly marketIndex: number;
  readonly maxLeverage: number;
  readonly venueRef: string;
};

export type VelocityMarketSnapshot = {
  readonly change24hBps: null;
  readonly openInterest: Amount;
  readonly price: Amount;
  readonly priceStale: boolean;
  readonly publishedAtMs: number;
  readonly venueRef: string;
  readonly volume24h: Amount;
};

export type VelocityMarketFeed = {
  readonly markets: readonly VelocityMarket[];
  readonly snapshots: readonly VelocityMarketSnapshot[];
};

export async function openVelocityMarketFeed(input: {
  readonly assetOrigin: string;
  readonly onError: (cause: unknown) => void;
  readonly onUpdate: (feed: VelocityMarketFeed) => void;
  readonly programId: string;
  readonly rpcUrl: string;
}): Promise<() => Promise<void>> {
  const configured = initialize({ env: 'mainnet-beta' });
  if (
    configured.VELOCITY_PROGRAM_ID !== input.programId ||
    configured.QUOTE_MINT_ADDRESS !== 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'
  ) {
    throw new Error('Velocity mainnet configuration does not match the installed SDK.');
  }

  const connection = new Connection(input.rpcUrl, 'confirmed');
  const programId = new PublicKey(input.programId);
  const coder = VelocityCore.coder();
  const stateAddress = await VelocityCore.pdas.getVelocityStateAccountPublicKey(programId);
  const addresses = [
    stateAddress,
    ...MainnetPerpMarkets.map((market) =>
      VelocityCore.pdas.getPerpMarketPublicKeySync(programId, market.marketIndex),
    ),
    ...MainnetPerpMarkets.map((market) => market.oracle),
  ];
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const poll = async (): Promise<void> => {
    try {
      const response = await connection.getMultipleAccountsInfoAndContext(addresses, 'confirmed');
      if (!closed) {
        input.onUpdate(decodeFeed(response.context.slot, response.value, coder, input.assetOrigin));
      }
    } catch (cause) {
      if (!closed) input.onError(cause);
    } finally {
      if (!closed) timer = setTimeout(() => void poll(), POLL_INTERVAL_MS);
    }
  };

  await poll();
  return async () => {
    closed = true;
    if (timer !== null) clearTimeout(timer);
  };
}

type AccountCoder = ReturnType<typeof VelocityCore.coder>;
type AccountInfo = Awaited<
  ReturnType<Connection['getMultipleAccountsInfoAndContext']>
>['value'][number];
type IntegerValue = { readonly toString: () => string };
type RawStateAccount = {
  readonly oracle_guard_rails: {
    readonly validity: { readonly slots_before_stale_for_amm: IntegerValue };
  };
};
type RawPerpMarketAccount = {
  readonly base_asset_amount_long: IntegerValue;
  readonly base_asset_amount_short: IntegerValue;
  readonly margin_ratio_initial: number;
  readonly market_index: number;
  readonly market_stats: { readonly volume_24h: IntegerValue };
  readonly oracle: PublicKey;
};
type RawPythLazerOracle = {
  readonly exponent: number;
  readonly posted_slot: IntegerValue;
  readonly price: IntegerValue;
};

function decodeFeed(
  currentSlot: number,
  infos: readonly AccountInfo[],
  coder: AccountCoder,
  assetOrigin: string,
): VelocityMarketFeed {
  const stateInfo = infos[0];
  if (stateInfo == null) throw new Error('Velocity state account is unavailable.');
  const state = coder.accounts.decode<RawStateAccount>('State', Buffer.from(stateInfo.data));
  const staleAfterSlots = BigInt(
    state.oracle_guard_rails.validity.slots_before_stale_for_amm.toString(),
  );
  const marketOffset = 1;
  const oracleOffset = marketOffset + MainnetPerpMarkets.length;
  const publishedAtMs = Date.now();
  const markets: VelocityMarket[] = [];
  const snapshots: VelocityMarketSnapshot[] = [];

  for (let index = 0; index < MainnetPerpMarkets.length; index += 1) {
    const config = MainnetPerpMarkets[index];
    const marketInfo = infos[marketOffset + index];
    const oracleInfo = infos[oracleOffset + index];
    if (config === undefined || marketInfo == null || oracleInfo == null) continue;

    const account = coder.accounts.decode<RawPerpMarketAccount>(
      'PerpMarket',
      Buffer.from(marketInfo.data),
    );
    if (account.market_index !== config.marketIndex || !account.oracle.equals(config.oracle)) {
      throw new Error(`Velocity market ${config.marketIndex} does not match the installed SDK.`);
    }
    if (account.margin_ratio_initial <= 0) continue;

    const oracle = coder.accounts.decode<RawPythLazerOracle>(
      'PythLazerOracle',
      Buffer.from(oracleInfo.data),
    );
    const priceBaseUnits = normalizeVelocityOraclePrice(
      BigInt(oracle.price.toString()),
      oracle.exponent,
    );
    if (priceBaseUnits <= 0n) continue;

    const baseOpenInterest = max(
      absolute(BigInt(account.base_asset_amount_long.toString())),
      absolute(BigInt(account.base_asset_amount_short.toString())),
    );
    const venueRef = String(config.marketIndex);
    markets.push({
      baseAsset: config.baseAssetSymbol,
      displayName: config.fullName ?? config.baseAssetSymbol,
      iconUrl: `${assetOrigin}/imgs/tokens/${encodeURIComponent(config.baseAssetSymbol)}.svg`,
      marketIndex: config.marketIndex,
      maxLeverage: Math.max(1, Math.floor(MARGIN_PRECISION / account.margin_ratio_initial)),
      venueRef,
    });
    snapshots.push({
      change24hBps: null,
      openInterest: amountFromBaseUnits(
        (baseOpenInterest * priceBaseUnits) / BASE_PRECISION,
        QUOTE_DECIMALS,
      ),
      price: amountFromBaseUnits(priceBaseUnits, PRICE_DECIMALS),
      priceStale: isVelocityOracleStale(
        currentSlot,
        BigInt(oracle.posted_slot.toString()),
        staleAfterSlots,
      ),
      publishedAtMs,
      venueRef,
      volume24h: amountFromBaseUnits(
        BigInt(account.market_stats.volume_24h.toString()),
        QUOTE_DECIMALS,
      ),
    });
  }

  if (markets.length === 0) throw new Error('Velocity returned no active markets.');
  return { markets, snapshots };
}

export function normalizeVelocityOraclePrice(price: bigint, exponent: number): bigint {
  if (!Number.isInteger(exponent) || exponent < -18 || exponent > 18) {
    throw new Error('Velocity returned an invalid oracle exponent.');
  }
  const scale = exponent + PRICE_DECIMALS;
  return scale >= 0
    ? price * (10n ** BigInt(scale))
    : price / (10n ** BigInt(-scale));
}

export function isVelocityOracleStale(
  currentSlot: number,
  postedSlot: bigint,
  staleAfterSlots: bigint,
): boolean {
  const age = BigInt(currentSlot) - postedSlot;
  return staleAfterSlots <= 0n || age < 0n || age > staleAfterSlots;
}

function absolute(value: bigint): bigint {
  return value < 0n ? -value : value;
}

function max(left: bigint, right: bigint): bigint {
  return left > right ? left : right;
}
