import type { PacificaMarketSnapshot } from '@/integrations/perps/pacifica/pacificaMarketData';
import type {
  PacificaPortfolioSnapshot,
  PacificaPosition,
} from '@/integrations/perps/pacifica/pacificaPortfolio';
import {
  formatDecimal,
  parseDecimal,
  PacificaOrderValidationError,
  type PacificaOrderSide,
} from '@/integrations/perps/pacifica/pacificaOrderValidation';

const SIZE_DECIMALS = 10;
const USD_DECIMALS = 6;

/**
 * Projection using Pacifica's published margin and liquidation formulas.
 * All values remain exact base units until the display boundary.
 */
export type PacificaProjectedRisk = {
  readonly accountHealthBps: bigint;
  readonly initialMarginBaseUnits: bigint;
  readonly liquidationPrice: string | null;
  readonly maintenanceHeadroomBaseUnits: bigint;
  readonly projectedAvailableBaseUnits: bigint;
  readonly projectedEquityBaseUnits: bigint;
  readonly projectedMaintenanceBaseUnits: bigint;
  readonly projectedMarginUsedBaseUnits: bigint;
  readonly resultingPositionAmount: string;
  readonly verifiedAtMs: number;
};

export function projectPacificaOpeningRisk(input: {
  readonly amountBaseUnits: bigint;
  readonly estimatedFeeBaseUnits: bigint;
  readonly leverage: number;
  readonly marginMode: 'isolated' | 'cross';
  readonly maxLeverage: number;
  readonly notionalBaseUnits: bigint;
  readonly portfolio: PacificaPortfolioSnapshot;
  readonly side: PacificaOrderSide;
  readonly sizingPriceBaseUnits: bigint;
  readonly snapshot: PacificaMarketSnapshot;
  readonly symbol: string;
}): PacificaProjectedRisk {
  const opposite = input.portfolio.positions.find(
    (position) => position.symbol === input.symbol && position.side !== input.side,
  );
  if (opposite !== undefined) {
    throw new PacificaOrderValidationError(
      `Close the existing ${opposite.side} position before opening the opposite side.`,
    );
  }

  const current = input.portfolio.positions.find(
    (position) => position.symbol === input.symbol && position.side === input.side,
  );
  if (current !== undefined && current.marginMode !== input.marginMode) {
    throw new PacificaOrderValidationError(
      `The open position uses ${current.marginMode} margin. Close it before changing margin mode.`,
    );
  }

  const currentAmount = current === undefined
    ? 0n
    : parseDecimal(current.amount, SIZE_DECIMALS);
  const resultingAmount = currentAmount + input.amountBaseUnits;
  const initialMargin = divideRoundUp(input.notionalBaseUnits, BigInt(input.leverage));
  const projectedAvailable = parseDecimal(input.portfolio.availableToSpend, USD_DECIMALS)
    - initialMargin
    - input.estimatedFeeBaseUnits;
  if (projectedAvailable < 0n) {
    throw new PacificaOrderValidationError(
      'Pacifica does not have enough available margin for this order and its estimated fee.',
    );
  }

  const accountEquity = parseDecimal(input.portfolio.accountEquity, USD_DECIMALS);
  const projectedEquity = accountEquity - input.estimatedFeeBaseUnits;
  if (projectedEquity <= 0n) {
    throw new PacificaOrderValidationError('The order would leave no positive account equity.');
  }

  const projectedMarginUsed = parseDecimal(input.portfolio.totalMarginUsed, USD_DECIMALS)
    + initialMargin;
  const markNotional = usdNotional(resultingAmount, input.snapshot.price.baseUnits);
  const resultingMaintenance = divideRoundUp(
    markNotional,
    BigInt(input.maxLeverage) * 2n,
  );
  const riskMargin = input.marginMode === 'cross'
    ? projectedCrossEquity(input.portfolio, input.estimatedFeeBaseUnits)
    : isolatedMargin(current) + initialMargin;
  const projectedMaintenance = input.marginMode === 'cross'
    ? parseDecimal(input.portfolio.crossMmr, USD_DECIMALS)
      + divideRoundUp(input.notionalBaseUnits, BigInt(input.maxLeverage) * 2n)
    : resultingMaintenance;
  const maintenanceHeadroom = riskMargin - projectedMaintenance;
  if (projectedMaintenance <= 0n || maintenanceHeadroom <= 0n) {
    throw new PacificaOrderValidationError(
      'Pacifica risk checks show insufficient maintenance-margin headroom.',
    );
  }

  return {
    accountHealthBps: (riskMargin * 10_000n) / projectedMaintenance,
    initialMarginBaseUnits: initialMargin,
    liquidationPrice: liquidationPrice({
      marginBaseUnits: riskMargin,
      maxLeverage: input.maxLeverage,
      positionSizeBaseUnits: resultingAmount,
      priceBaseUnits: input.marginMode === 'cross'
        ? input.snapshot.price.baseUnits
        : projectedEntryPrice(current, input.amountBaseUnits, input.sizingPriceBaseUnits),
      priceDecimals: input.snapshot.price.decimals,
      side: input.side,
    }),
    maintenanceHeadroomBaseUnits: maintenanceHeadroom,
    projectedAvailableBaseUnits: projectedAvailable,
    projectedEquityBaseUnits: projectedEquity,
    projectedMaintenanceBaseUnits: projectedMaintenance,
    projectedMarginUsedBaseUnits: projectedMarginUsed,
    resultingPositionAmount: formatDecimal(resultingAmount, SIZE_DECIMALS),
    verifiedAtMs: input.portfolio.fetchedAtMs,
  };
}

function projectedCrossEquity(
  portfolio: PacificaPortfolioSnapshot,
  feeBaseUnits: bigint,
): bigint {
  const crossPositions = portfolio.positions.filter(
    (position) => position.marginMode === 'cross',
  );
  if (crossPositions.some((position) => position.unrealizedPnl === null)) {
    throw new PacificaOrderValidationError(
      'Pacifica did not provide complete cross-position PnL, so account health cannot be verified.',
    );
  }
  const unrealized = crossPositions.reduce(
    (total, position) => total + parseDecimal(position.unrealizedPnl ?? '0', USD_DECIMALS),
    0n,
  );
  const current = parseDecimal(portfolio.balance, USD_DECIMALS) + unrealized;
  const result = current - feeBaseUnits;
  if (result <= 0n) {
    throw new PacificaOrderValidationError('The order would leave no positive cross-account equity.');
  }
  return result;
}

function projectedEntryPrice(
  position: PacificaPosition | undefined,
  addedAmount: bigint,
  addedPrice: bigint,
): bigint {
  if (position === undefined) return addedPrice;
  const currentAmount = parseDecimal(position.amount, SIZE_DECIMALS);
  const currentPrice = parseDecimal(position.entryPrice, 10);
  const resultingAmount = currentAmount + addedAmount;
  return (currentAmount * currentPrice + addedAmount * addedPrice) / resultingAmount;
}

function isolatedMargin(position: PacificaPosition | undefined): bigint {
  return position === undefined ? 0n : parseDecimal(position.margin, USD_DECIMALS);
}

function liquidationPrice(input: {
  readonly marginBaseUnits: bigint;
  readonly maxLeverage: number;
  readonly positionSizeBaseUnits: bigint;
  readonly priceBaseUnits: bigint;
  readonly priceDecimals: number;
  readonly side: PacificaOrderSide;
}): string | null {
  const marginPerToken = (input.marginBaseUnits * 10n ** BigInt(SIZE_DECIMALS + input.priceDecimals - USD_DECIMALS))
    / input.positionSizeBaseUnits;
  const side = input.side === 'long' ? 1n : -1n;
  const numerator = input.priceBaseUnits - side * marginPerToken;
  if (numerator <= 0n) return null;
  const doubleLeverage = BigInt(input.maxLeverage) * 2n;
  const denominator = doubleLeverage - side;
  return formatDecimal((numerator * doubleLeverage) / denominator, input.priceDecimals);
}

function usdNotional(amountBaseUnits: bigint, priceBaseUnits: bigint): bigint {
  return (amountBaseUnits * priceBaseUnits) / 10n ** 14n;
}

function divideRoundUp(value: bigint, divisor: bigint): bigint {
  if (value < 0n || divisor <= 0n) throw new Error('Pacifica risk inputs are invalid.');
  return (value + divisor - 1n) / divisor;
}
