import { EventEmitter } from 'events';

import type { UserAccountSubscriber } from '@velocity-exchange/sdk/lib/browser/accounts/types';
import { getPerpMarketPublicKeySync, getSpotMarketPublicKeySync, getUserAccountPublicKeySync } from '@velocity-exchange/sdk/lib/browser/addresses/pda';
import { MainnetPerpMarkets } from '@velocity-exchange/sdk/lib/browser/constants/perpMarkets';
import { CustomBorshAccountsCoder } from '@velocity-exchange/sdk/lib/browser/decode/customCoder';
import { decodeUser } from '@velocity-exchange/sdk/lib/browser/decode/user';
import velocityIdl from '@velocity-exchange/sdk/lib/browser/idl/velocity.json';
import { calculatePositionPNL } from '@velocity-exchange/sdk/lib/browser/math/position';
import type { OraclePriceData } from '@velocity-exchange/sdk/lib/browser/oracles/types';
import type { PerpMarketAccount, SpotMarketAccount, StateAccount, UserAccount } from '@velocity-exchange/sdk/lib/browser/types';
import { User } from '@velocity-exchange/sdk/lib/browser/user';
import type { VelocityClient } from '@velocity-exchange/sdk/lib/browser/velocityClient';
import { PublicKey } from '@solana/web3.js';

import { amountFromBaseUnits, type Amount } from '@/domain/money/amount';
import {
  fetchPublicProgramAccount,
  fetchPublicProgramAccounts,
} from '@/integrations/api/publicSolanaRpc';
import type { MainnetMarket } from '@/integrations/perps/markets/mainnetCatalog';
import type { PublicMarketPrice } from '@/integrations/perps/markets/publicMarketData';
import { normalizeVelocityAccount } from '@/integrations/perps/velocity/normalizeVelocityAccount';

const QUOTE_SPOT_MARKET_INDEX = 0;

const coder = new CustomBorshAccountsCoder<'PerpMarket' | 'SpotMarket'>(
  velocityIdl as unknown as ConstructorParameters<
    typeof CustomBorshAccountsCoder
  >[0],
);

export type VelocityPortfolioPosition = {
  readonly marketIndex: number;
  readonly symbol: string;
  readonly side: 'Long' | 'Short';
  readonly size: Amount;
  readonly entryPrice: Amount | null;
  readonly unrealizedPnl: Amount | null;
  readonly liquidationPrice: Amount | null;
  readonly openOrders: number;
  readonly coreMarket: boolean;
};

export type VelocityMarginSummary = {
  readonly totalCollateral: Amount;
  readonly freeCollateral: Amount;
  readonly initialMargin: Amount;
  readonly maintenanceMargin: Amount;
  readonly healthPercent: number;
};

export type VelocityPortfolioSnapshot = {
  readonly initialized: boolean;
  readonly accountAddress: string;
  readonly positions: readonly VelocityPortfolioPosition[];
  readonly openOrders: number;
  readonly nonCorePositionCount: number;
  readonly unsupportedSpotPositionCount: number;
  readonly margin: VelocityMarginSummary | null;
  readonly slot: number;
};

export async function fetchVelocityPortfolio(
  rpcUrl: string,
  programId: string,
  walletAddress: string,
  markets: readonly MainnetMarket[],
  prices: readonly PublicMarketPrice[],
  signal: AbortSignal,
): Promise<VelocityPortfolioSnapshot> {
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

  const userAccount = decodeUser(response.account);

  if (!userAccount.authority.equals(authority)) {
    throw new Error('Velocity returned a user account for another authority.');
  }

  const activePerps = userAccount.perpPositions.filter(isActivePerpPosition);
  const activeSpotIndexes = userAccount.spotPositions
    .filter((position) => !isZero(position.scaledBalance) || position.openOrders > 0)
    .map((position) => position.marketIndex);
  const perpIndexes = [...new Set(activePerps.map((position) => position.marketIndex))];
  const marketAddresses = perpIndexes.map((index) =>
    getPerpMarketPublicKeySync(program, index).toBase58(),
  );
  const quoteSpotAddress = getSpotMarketPublicKeySync(
    program,
    QUOTE_SPOT_MARKET_INDEX,
  ).toBase58();
  const accountSet = await fetchPublicProgramAccounts(
    rpcUrl,
    [...marketAddresses, quoteSpotAddress],
    programId,
    signal,
  );
  const perpMarkets = new Map<number, PerpMarketAccount>();

  perpIndexes.forEach((expectedIndex, position) => {
    const data = accountSet.accounts[position];

    if (data === undefined) {
      throw new Error('Velocity omitted an active perpetual market account.');
    }

    const market = normalizeVelocityAccount<PerpMarketAccount>(
      coder.decode<PerpMarketAccount>('PerpMarket', data),
    );

    if (market.marketIndex !== expectedIndex) {
      throw new Error('Velocity returned a mismatched perpetual market account.');
    }

    perpMarkets.set(expectedIndex, market);
  });

  const quoteSpotData = accountSet.accounts[marketAddresses.length];

  if (quoteSpotData === undefined) {
    throw new Error('Velocity omitted its quote spot market account.');
  }

  const quoteSpotMarket = normalizeVelocityAccount<SpotMarketAccount>(
    coder.decode<SpotMarketAccount>('SpotMarket', quoteSpotData),
  );

  if (quoteSpotMarket.marketIndex !== QUOTE_SPOT_MARKET_INDEX) {
    throw new Error('Velocity returned a mismatched quote spot market account.');
  }

  const coreMarkets = new Map(
    markets.map((market) => [Number(market.venueRef), market]),
  );
  const pricesBySymbol = new Map(prices.map((price) => [price.symbol, price]));
  const oracleByIndex = new Map<number, OraclePriceData>();

  for (const [index, market] of coreMarkets) {
    const price = pricesBySymbol.get(market.symbol);
    const perpMarket = perpMarkets.get(index);

    if (price !== undefined && !price.stale && perpMarket !== undefined) {
      oracleByIndex.set(index, oracleData(perpMarket, price, accountSet.slot));
    }
  }

  const supportsFullRisk =
    activeSpotIndexes.every((index) => index === QUOTE_SPOT_MARKET_INDEX) &&
    activePerps.every((position) =>
      oracleByIndex.has(position.marketIndex),
    );
  const riskUser = supportsFullRisk
    ? createReadOnlyVelocityUser(
        userAddress,
        userAccount,
        accountSet.slot,
        perpMarkets,
        quoteSpotMarket,
        oracleByIndex,
      )
    : null;
  const positions = activePerps
    .filter((position) => !isZero(position.baseAssetAmount))
    .map((position) => {
      const coreMarket = coreMarkets.get(position.marketIndex);
      const marketConfig = MainnetPerpMarkets.find(
        (entry) => entry.marketIndex === position.marketIndex,
      );
      const price = coreMarket === undefined
        ? null
        : pricesBySymbol.get(coreMarket.symbol) ?? null;
      const perpMarket = perpMarkets.get(position.marketIndex);
      const oracle = oracleByIndex.get(position.marketIndex);
      const unrealizedPnl =
        price === null || price.stale || perpMarket === undefined || oracle === undefined
          ? null
          : amountFromBaseUnits(
              BigInt(
                calculatePositionPNL(
                  perpMarket,
                  position,
                  true,
                  oracle,
                ).toString(),
              ),
              6,
            );
      const liquidation = riskUser?.liquidationPrice(
        position.marketIndex,
        undefined,
        undefined,
        'Maintenance',
        true,
      );

      return {
        marketIndex: position.marketIndex,
        symbol: marketConfig?.symbol ?? `PERP-${position.marketIndex}`,
        side: isNegative(position.baseAssetAmount) ? 'Short' : 'Long',
        size: amountFromBaseUnits(
          abs(BigInt(position.baseAssetAmount.toString())),
          9,
        ),
        entryPrice: entryPrice(
          BigInt(position.baseAssetAmount.toString()),
          BigInt(position.quoteEntryAmount.toString()),
        ),
        unrealizedPnl,
        liquidationPrice:
          liquidation === undefined || isNegative(liquidation)
            ? null
            : amountFromBaseUnits(BigInt(liquidation.toString()), 6),
        openOrders: position.openOrders,
        coreMarket: coreMarket !== undefined,
      } satisfies VelocityPortfolioPosition;
    });

  return {
    initialized: true,
    accountAddress: userAddress.toBase58(),
    positions,
    openOrders: userAccount.openOrders,
    nonCorePositionCount: positions.filter((position) => !position.coreMarket).length,
    unsupportedSpotPositionCount: activeSpotIndexes.filter(
      (index) => index !== QUOTE_SPOT_MARKET_INDEX,
    ).length,
    margin: riskUser === null ? null : marginSummary(riskUser),
    slot: Math.max(response.slot, accountSet.slot),
  };
}

export function createReadOnlyVelocityUser(
  address: PublicKey,
  account: UserAccount,
  slot: number,
  perpMarkets: ReadonlyMap<number, PerpMarketAccount>,
  quoteSpotMarket: SpotMarketAccount,
  oracles: ReadonlyMap<number, OraclePriceData>,
  stateAccount?: StateAccount,
): User {
  const Bn = quoteSpotMarket.depositBalance.constructor as unknown as new (
    input: string,
  ) => SpotMarketAccount['depositBalance'];
  const quoteOracle = {
    price: new Bn('1000000'),
    slot: new Bn(slot.toString()),
    confidence: new Bn('1'),
    hasSufficientNumberOfDataPoints: true,
  } as OraclePriceData;
  const required = <T,>(value: T | undefined, label: string): T => {
    if (value === undefined) {
      throw new Error(`Velocity risk data omitted ${label}.`);
    }

    return value;
  };
  const client = {
    getPerpMarketAccount: (index: number) =>
      required(perpMarkets.get(index), `perpetual market ${index}`),
    getSpotMarketAccount: (index: number) =>
      index === QUOTE_SPOT_MARKET_INDEX
        ? quoteSpotMarket
        : required(undefined, `spot market ${index}`),
    getSpotMarketAccounts: () => [quoteSpotMarket],
    getQuoteSpotMarketAccount: () => quoteSpotMarket,
    getOracleDataForPerpMarket: (index: number) =>
      required(oracles.get(index), `oracle ${index}`),
    getMMOracleDataForPerpMarket: (index: number) => ({
      ...required(oracles.get(index), `oracle ${index}`),
      isMMOracleActive: false,
    }),
    getOracleDataForSpotMarket: (index: number) =>
      index === QUOTE_SPOT_MARKET_INDEX
        ? quoteOracle
        : required(undefined, `spot oracle ${index}`),
    getPerpMarketAccountOrThrow: (index: number) =>
      required(perpMarkets.get(index), `perpetual market ${index}`),
    getSpotMarketAccountOrThrow: (index: number) =>
      index === QUOTE_SPOT_MARKET_INDEX
        ? quoteSpotMarket
        : required(undefined, `spot market ${index}`),
    getStateAccount: () => required(stateAccount, 'state account'),
  } as unknown as VelocityClient;
  const subscriber = {
    eventEmitter: new EventEmitter(),
    isSubscribed: true,
    subscribe: async () => true,
    fetch: async () => undefined,
    updateData: () => undefined,
    unsubscribe: async () => undefined,
    getUserAccountAndSlot: () => ({ data: account, slot }),
  } as unknown as UserAccountSubscriber;

  return new User({
    velocityClient: client,
    userAccountPublicKey: address,
    accountSubscription: { type: 'custom', userAccountSubscriber: subscriber },
  });
}

function marginSummary(user: User): VelocityMarginSummary {
  const initial = user.getMarginCalculation('Initial');
  const maintenance = user.getMarginCalculation('Maintenance');
  const totalCollateral = BigInt(initial.totalCollateral.toString());
  const initialMargin = BigInt(initial.marginRequirement.toString());
  const freeCollateral = totalCollateral > initialMargin
    ? totalCollateral - initialMargin
    : 0n;

  return {
    totalCollateral: amountFromBaseUnits(totalCollateral, 6),
    freeCollateral: amountFromBaseUnits(freeCollateral, 6),
    initialMargin: amountFromBaseUnits(initialMargin, 6),
    maintenanceMargin: velocityAmount(maintenance.marginRequirement),
    healthPercent: user.getHealth(),
  };
}

function oracleData(
  market: PerpMarketAccount,
  price: PublicMarketPrice,
  slot: number,
): OraclePriceData {
  const Bn = market.amm.pegMultiplier.constructor as unknown as new (
    input: string,
  ) => PerpMarketAccount['amm']['pegMultiplier'];

  return {
    price: new Bn(toSixDecimals(price.price).toString()),
    confidence: new Bn(toSixDecimals(price.confidence).toString()),
    slot: new Bn(slot.toString()),
    hasSufficientNumberOfDataPoints: true,
  } as OraclePriceData;
}

function emptySnapshot(
  userAddress: PublicKey,
  slot: number,
): VelocityPortfolioSnapshot {
  return {
    initialized: false,
    accountAddress: userAddress.toBase58(),
    positions: [],
    openOrders: 0,
    nonCorePositionCount: 0,
    unsupportedSpotPositionCount: 0,
    margin: null,
    slot,
  };
}

function isActivePerpPosition(
  position: UserAccount['perpPositions'][number],
): boolean {
  return (
    !isZero(position.baseAssetAmount) ||
    !isZero(position.quoteAssetAmount) ||
    position.openOrders > 0 ||
    !isZero(position.isolatedPositionScaledBalance)
  );
}

function entryPrice(baseAssetAmount: bigint, quoteEntryAmount: bigint): Amount | null {
  const base = abs(baseAssetAmount);

  return base === 0n
    ? null
    : amountFromBaseUnits((abs(quoteEntryAmount) * 1_000_000_000n) / base, 6);
}

function toSixDecimals(amount: Amount): bigint {
  return amount.decimals === 6
    ? amount.baseUnits
    : amount.baseUnits / 10n ** BigInt(amount.decimals - 6);
}

function velocityAmount(value: { toString(): string }): Amount {
  return amountFromBaseUnits(BigInt(value.toString()), 6);
}

function abs(value: bigint): bigint {
  return value < 0n ? -value : value;
}

function isZero(value: { toString(): string }): boolean {
  return BigInt(value.toString()) === 0n;
}

function isNegative(value: { toString(): string }): boolean {
  return BigInt(value.toString()) < 0n;
}
