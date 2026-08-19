import { MainnetPerpMarkets } from '@velocity-exchange/sdk/lib/browser/constants/perpMarkets';
import { calculateEntryPrice } from '@velocity-exchange/sdk/lib/browser/math/position';
import { getVariant, isVariant, PositionFlag } from '@velocity-exchange/sdk/lib/browser/types';
import type { VelocityClient } from '@velocity-exchange/sdk/lib/browser/velocityClient';

import type { VelocitySide } from '@/integrations/perps/velocity/velocityTrade';

export type VelocityPosition = {
  readonly baseAssetAmount: bigint;
  readonly entryPriceBaseUnits: bigint;
  readonly liquidationPriceBaseUnits: bigint | null;
  readonly marginMode: 'Cross' | 'Isolated';
  readonly marketIndex: number;
  readonly markPriceBaseUnits: bigint;
  readonly openOrders: number;
  readonly pnlBaseUnits: bigint;
  readonly side: VelocitySide;
  readonly symbol: string;
};

export type VelocityOpenOrder = {
  readonly marketIndex: number;
  readonly orderId: number;
  readonly orderType: string;
  readonly priceBaseUnits: bigint | null;
  readonly reduceOnly: boolean;
  readonly remainingBaseUnits: bigint;
  readonly side: VelocitySide;
  readonly symbol: string;
};

export type VelocityAccountSnapshot = {
  readonly equityBaseUnits: bigint;
  readonly freeCollateralBaseUnits: bigint;
  readonly orders: readonly VelocityOpenOrder[];
  readonly positions: readonly VelocityPosition[];
  readonly unrealizedPnlBaseUnits: bigint;
};

export function readVelocityAccountSnapshot(client: VelocityClient): VelocityAccountSnapshot {
  const user = client.getUser(0);
  const positions = user.getActivePerpPositions()
    .filter((position) => BigInt(position.baseAssetAmount.toString()) !== 0n)
    .map((position): VelocityPosition => {
      const baseAssetAmount = BigInt(position.baseAssetAmount.toString());
      const liquidationPrice = user.liquidationPrice(position.marketIndex);
      return {
        baseAssetAmount,
        entryPriceBaseUnits: BigInt(calculateEntryPrice(position).toString()),
        liquidationPriceBaseUnits: BigInt(liquidationPrice.toString()) < 0n
          ? null
          : BigInt(liquidationPrice.toString()),
        marginMode: (position.positionFlag & PositionFlag.IsolatedPosition) !== 0
          ? 'Isolated'
          : 'Cross',
        marketIndex: position.marketIndex,
        markPriceBaseUnits: BigInt(
          client.getMMOracleDataForPerpMarket(position.marketIndex).price.toString(),
        ),
        openOrders: position.openOrders,
        pnlBaseUnits: BigInt(user.getUnrealizedPNL(true, position.marketIndex).toString()),
        side: baseAssetAmount > 0n ? 'long' : 'short',
        symbol: velocityMarketSymbol(position.marketIndex),
      };
    });
  const orders = user.getOpenOrders()
    .filter((order) => isVariant(order.marketType, 'perp'))
    .map((order): VelocityOpenOrder => {
      const amount = BigInt(order.baseAssetAmount.toString());
      const filled = BigInt(order.baseAssetAmountFilled.toString());
      return {
        marketIndex: order.marketIndex,
        orderId: order.orderId,
        orderType: getVariant(order.orderType),
        priceBaseUnits: BigInt(order.price.toString()) === 0n
          ? null
          : BigInt(order.price.toString()),
        reduceOnly: order.reduceOnly,
        remainingBaseUnits: amount > filled ? amount - filled : 0n,
        side: isVariant(order.direction, 'long') ? 'long' : 'short',
        symbol: velocityMarketSymbol(order.marketIndex),
      };
    });
  return {
    equityBaseUnits: BigInt(user.getNetUsdValue().toString()),
    freeCollateralBaseUnits: BigInt(user.getFreeCollateral().toString()),
    orders,
    positions,
    unrealizedPnlBaseUnits: BigInt(user.getUnrealizedPNL(true).toString()),
  };
}

export function velocityCloseIntent(baseAssetAmount: bigint): {
  readonly amountBaseUnits: bigint;
  readonly side: VelocitySide;
} {
  if (baseAssetAmount === 0n) throw new Error('This Velocity position is already closed.');
  return {
    amountBaseUnits: baseAssetAmount < 0n ? -baseAssetAmount : baseAssetAmount,
    side: baseAssetAmount > 0n ? 'short' : 'long',
  };
}

export function velocityMarketSymbol(marketIndex: number): string {
  return MainnetPerpMarkets.find((market) => market.marketIndex === marketIndex)
    ?.baseAssetSymbol ?? `Market ${marketIndex}`;
}
