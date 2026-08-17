import type {
  PacificaMarket,
  PacificaMarketSnapshot,
} from '@/integrations/perps/pacifica/pacificaMarketData';

export type PacificaOrderAction = 'open' | 'close';
export type PacificaOrderSide = 'long' | 'short';
export type PacificaOrderType = 'market' | 'limit' | 'stop-market' | 'stop-limit';

export class PacificaOrderValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PacificaOrderValidationError';
  }
}

export function validatePacificaOrderDraft(input: {
  readonly action: PacificaOrderAction;
  readonly collateral: string;
  readonly leverage: string;
  readonly market: PacificaMarket;
  readonly orderPrice: string;
  readonly orderType: PacificaOrderType;
  readonly side: PacificaOrderSide;
  readonly snapshot: PacificaMarketSnapshot;
  readonly stopLossPrice: string;
  readonly takeProfitPrice: string;
  readonly tpSlEnabled: boolean;
  readonly triggerPrice: string;
}): void {
  const leverage = Number(input.leverage);
  if (input.action === 'open') {
    let collateral: bigint;
    try {
      collateral = parseDecimal(input.collateral.trim(), 6);
    } catch {
      throw new PacificaOrderValidationError('Enter a valid USDC collateral amount with up to 6 decimals.');
    }
    if (collateral <= 0n) throw new PacificaOrderValidationError('Collateral must be greater than zero.');
    if (!Number.isInteger(leverage) || leverage < 1 || leverage > input.market.maxLeverage) {
      throw new PacificaOrderValidationError(`Choose leverage from 1× to ${input.market.maxLeverage}×.`);
    }
  }
  if (input.tpSlEnabled && input.takeProfitPrice.trim().length === 0 && input.stopLossPrice.trim().length === 0) {
    throw new PacificaOrderValidationError('Enter a take-profit or stop-loss price.');
  }
  if (isStopOrder(input.orderType) && input.tpSlEnabled) {
    throw new PacificaOrderValidationError('TP/SL cannot be attached to a stop entry order.');
  }
  const mark = input.snapshot.price.baseUnits;
  orderPrices({
    action: input.action,
    decimals: input.snapshot.price.decimals,
    mark,
    orderPrice: input.orderPrice,
    orderType: input.orderType,
    side: input.side,
    tickSize: input.market.tickSize,
    triggerPrice: input.triggerPrice,
  });
  if (input.tpSlEnabled && input.takeProfitPrice.trim().length > 0) {
    validateTriggerPrice(input.takeProfitPrice, 'Take-profit', input.side, 'take-profit', mark, input.market.tickSize, input.snapshot.price.decimals);
  }
  if (input.tpSlEnabled && input.stopLossPrice.trim().length > 0) {
    validateTriggerPrice(input.stopLossPrice, 'Stop-loss', input.side, 'stop-loss', mark, input.market.tickSize, input.snapshot.price.decimals);
  }
}

export function orderPrices(input: {
  readonly action: PacificaOrderAction;
  readonly decimals: number;
  readonly mark: bigint;
  readonly orderPrice: string | undefined;
  readonly orderType: PacificaOrderType;
  readonly side: PacificaOrderSide;
  readonly tickSize: string;
  readonly triggerPrice: string | undefined;
}) {
  const needsLimit = input.orderType === 'limit' || input.orderType === 'stop-limit';
  const needsTrigger = isStopOrder(input.orderType);
  const order = needsLimit
    ? requestedPrice(input.orderPrice, 'Limit price', input.tickSize, input.decimals)
    : null;
  const trigger = needsTrigger
    ? requestedPrice(input.triggerPrice, 'Trigger price', input.tickSize, input.decimals)
    : null;
  if (trigger !== null) validateStopDirection(trigger, input.mark, signedSide(input.action, input.side));
  if (trigger !== null && order !== null) {
    const invalid = signedSide(input.action, input.side) === 'bid' ? order < trigger : order > trigger;
    if (invalid) {
      throw new PacificaOrderValidationError(
        `Stop-limit price must be ${signedSide(input.action, input.side) === 'bid' ? 'at or above' : 'at or below'} the trigger price.`,
      );
    }
  }
  return {
    orderBaseUnits: order,
    orderPrice: order === null ? null : formatDecimal(order, input.decimals),
    triggerBaseUnits: trigger,
    triggerPrice: trigger === null ? null : formatDecimal(trigger, input.decimals),
  };
}

export function validateTriggerPrice(
  value: string,
  label: string,
  side: PacificaOrderSide,
  kind: 'take-profit' | 'stop-loss',
  mark: bigint,
  tickSize: string,
  decimals: number,
): string {
  const price = requestedPrice(value, label, tickSize, decimals);
  const above = kind === 'take-profit' ? side === 'long' : side === 'short';
  if ((above && price <= mark) || (!above && price >= mark)) {
    throw new PacificaOrderValidationError(`${label} must be ${above ? 'above' : 'below'} the current mark.`);
  }
  return formatDecimal(price, decimals);
}

export function validateStopDirection(trigger: bigint, mark: bigint, side: 'bid' | 'ask'): void {
  const invalid = side === 'bid' ? trigger <= mark : trigger >= mark;
  if (invalid) {
    throw new PacificaOrderValidationError(
      `Trigger price must be ${side === 'bid' ? 'above' : 'below'} the current mark.`,
    );
  }
}

export function signedSide(action: PacificaOrderAction, side: PacificaOrderSide): 'bid' | 'ask' {
  if (action === 'open') return side === 'long' ? 'bid' : 'ask';
  return side === 'long' ? 'ask' : 'bid';
}

export function isStopOrder(orderType: PacificaOrderType): boolean {
  return orderType === 'stop-market' || orderType === 'stop-limit';
}

export function parseDecimal(value: string, decimals: number): bigint {
  if (!/^\d+(?:\.\d+)?$/u.test(value)) throw new Error('Pacifica decimal value is invalid.');
  const [whole = '0', fraction = ''] = value.split('.');
  if (fraction.length > decimals) throw new Error('Pacifica decimal precision is unsupported.');
  return BigInt(`${whole}${fraction.padEnd(decimals, '0')}`);
}

export function formatDecimal(value: bigint, decimals: number): string {
  const digits = value.toString().padStart(decimals + 1, '0');
  const whole = digits.slice(0, -decimals);
  const fraction = digits.slice(-decimals).replace(/0+$/u, '');
  return fraction.length === 0 ? whole : `${whole}.${fraction}`;
}

function requestedPrice(value: string | undefined, label: string, tickSize: string, decimals: number): bigint {
  let price: bigint;
  try {
    price = parseDecimal(value?.trim() ?? '', decimals);
  } catch {
    throw new PacificaOrderValidationError(`${label} is not a valid price.`);
  }
  const tick = parseDecimal(tickSize, decimals);
  if (price <= 0n || tick <= 0n || price % tick !== 0n) {
    throw new PacificaOrderValidationError(`${label} must be a positive multiple of the ${tickSize} tick size.`);
  }
  return price;
}
