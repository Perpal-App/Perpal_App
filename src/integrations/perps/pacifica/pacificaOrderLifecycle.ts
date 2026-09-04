import type { GatewayRequestSigner } from '@/integrations/api/gatewayClient';
import {
  PacificaApiError,
  pacificaGet,
  pacificaPostSigned,
  type PacificaOperation,
} from '@/integrations/perps/pacifica/pacificaApi';
import {
  removePendingPacificaCommand,
  writePendingPacificaCommand,
  type PacificaCreateCommand,
} from '@/integrations/perps/pacifica/pacificaCommandStorage';
import { parsePacificaPrices } from '@/integrations/perps/pacifica/pacificaMarketData';
import type { PacificaOrderPlan } from '@/integrations/perps/pacifica/pacificaOrder';
import { parsePacificaOrderId } from '@/integrations/perps/pacifica/pacificaOrderResponse';
import {
  fetchPacificaMarketSetting,
  isAmbiguousPacificaFailure,
  reconcilePendingPacificaCommand,
  type PacificaCommandReconciliation,
  type PacificaOrderStatus,
} from '@/integrations/perps/pacifica/pacificaOrderReconciliation';
import {
  isStopOrder,
  parseDecimal,
  validateStopDirection,
} from '@/integrations/perps/pacifica/pacificaOrderValidation';
import {
  newTraceId,
  recordClientTelemetry,
} from '@/integrations/observability/clientTelemetry';
import { logTradeTiming } from '@/integrations/observability/tradeTiming';

export type PacificaOrderSubmission = {
  readonly orderId: number;
  /** `accepted` is the REST acknowledgement; only reconciliation returns an exchange order state. */
  readonly orderStatus: PacificaOrderStatus | 'accepted';
  readonly traceId: string;
};

export type PacificaCancellationResult = {
  readonly orderStatus: PacificaOrderStatus | null;
  readonly status: 'cancelled' | 'not_cancelled' | 'pending' | 'terminal';
  readonly traceId: string;
};

export class PacificaCommandPendingError extends Error {
  constructor(
    message: string,
    readonly traceId: string,
  ) {
    super(message);
    this.name = 'PacificaCommandPendingError';
  }
}

export async function submitPacificaOrder(input: {
  readonly account: string;
  readonly apiOrigin: string;
  readonly intentStartedAtMs: number;
  readonly plan: PacificaOrderPlan;
  readonly signer: GatewayRequestSigner;
  readonly signal?: AbortSignal | undefined;
}): Promise<PacificaOrderSubmission> {
  requireCurrentPlan(input.plan);
  const recovered = await reconcilePendingPacificaCommand({
    account: input.account,
    apiOrigin: input.apiOrigin,
    signal: input.signal,
  });
  const prior = priorSubmission(recovered, input.plan.clientOrderId);
  if (prior !== null) return prior;
  if (recovered.status === 'review_required') {
    throw new Error('Pacifica settings changed or could not be verified. Prepare the order again.');
  }
  if (recovered.status === 'pending') {
    throw new PacificaCommandPendingError(
      'A previous Pacifica command is still reconciling. Do not submit it again.',
      recovered.traceId,
    );
  }

  await validateCurrentPrice(input);
  const request = orderRequest(input.plan);
  let command = createCommand(input, request);
  let orderSubmissionStarted = false;
  await writePendingPacificaCommand(command);
  try {
    if (input.plan.action === 'open') {
      command = await applySettings(input, command);
    }
    requireCurrentPlan(input.plan);
    await validateCurrentPrice(input);
    command = {
      ...command,
      attemptedAtMs: Date.now(),
      stage: 'order_pending',
      updatedAtMs: Date.now(),
    };
    await writePendingPacificaCommand(command);
    orderSubmissionStarted = true;
    return await postOrder(input, request, command);
  } catch (cause) {
    if (cause instanceof PacificaCommandPendingError) throw cause;
    if (!orderSubmissionStarted || !isAmbiguousPacificaFailure(cause)) {
      await removePendingPacificaCommand(input.account);
      throw cause;
    }
    const resolution = await reconcileAfterFailure(input, command.traceId, cause);
    if (resolution !== null) return resolution;
    throw new PacificaCommandPendingError(
      'Pacifica may have received this order. Its client order ID is being reconciled; do not submit again.',
      command.traceId,
    );
  }
}

export async function cancelPacificaOrder(input: {
  readonly account: string;
  readonly apiOrigin: string;
  readonly clientOrderId: string | null;
  readonly orderId: number;
  readonly signer: GatewayRequestSigner;
  readonly signal?: AbortSignal | undefined;
  readonly symbol: string;
}): Promise<PacificaCancellationResult> {
  const recovered = await reconcilePendingPacificaCommand({
    account: input.account,
    apiOrigin: input.apiOrigin,
    signal: input.signal,
  });
  const prior = priorCancellation(recovered, input.orderId);
  if (prior !== null) return prior;
  if (recovered.status === 'pending') {
    throw new PacificaCommandPendingError(
      'A previous Pacifica command is still reconciling. Do not sign another cancellation yet.',
      recovered.traceId,
    );
  }

  const traceId = newTraceId();
  const attemptedAtMs = Date.now();
  await writePendingPacificaCommand({
    attemptedAtMs,
    clientOrderId: input.clientOrderId,
    kind: 'cancel',
    orderId: input.orderId,
    owner: input.account,
    stage: 'cancel_pending',
    symbol: input.symbol,
    traceId,
    updatedAtMs: attemptedAtMs,
    version: 1,
  });
  const startedAt = performance.now();
  try {
    await pacificaPostSigned({
      account: input.account,
      apiOrigin: input.apiOrigin,
      operation: 'cancel_order',
      payload: { order_id: input.orderId, symbol: input.symbol },
      signer: input.signer,
      signal: input.signal,
    });
    await removePendingPacificaCommand(input.account);
    recordOutcome('cancel', traceId, startedAt, 'ok');
    return { orderStatus: 'cancelled', status: 'cancelled', traceId };
  } catch (cause) {
    recordOutcome('cancel', traceId, startedAt, input.signal?.aborted ? 'cancelled' : 'error', cause);
    let resolution: PacificaCommandReconciliation | null = null;
    try {
      resolution = await reconcilePendingPacificaCommand({
        account: input.account,
        apiOrigin: input.apiOrigin,
        signal: input.signal,
      });
    } catch {
      // The durable command remains for a later authoritative refresh.
    }
    const resolved = priorCancellation(resolution, input.orderId);
    if (resolved !== null) return resolved;
    if (isAmbiguousPacificaFailure(cause)) {
      return { orderStatus: null, status: 'pending', traceId };
    }
    await removePendingPacificaCommand(input.account);
    throw cause;
  }
}

async function applySettings(
  input: Parameters<typeof submitPacificaOrder>[0],
  initial: PacificaCreateCommand,
): Promise<PacificaCreateCommand> {
  const reviewedSetting = input.plan.reviewedSetting;
  if (reviewedSetting === null) {
    throw new Error('Pacifica margin settings were not included in the confirmed order.');
  }
  const current = await fetchPacificaMarketSetting({
    account: input.account,
    apiOrigin: input.apiOrigin,
    maxLeverage: input.plan.maxLeverage,
    signal: input.signal,
    symbol: input.plan.symbol,
  });
  if (
    current.leverage !== reviewedSetting.leverage ||
    current.marginMode !== reviewedSetting.marginMode
  ) {
    throw new Error('Pacifica margin settings changed after review. Prepare the order again.');
  }

  let command = initial;
  if (current.marginMode !== input.plan.marginMode) {
    command = { ...command, stage: 'margin_pending', updatedAtMs: Date.now() };
    await writePendingPacificaCommand(command);
    await applySetting(input, command, 'update_margin_mode', {
      is_isolated: input.plan.marginMode === 'isolated',
      symbol: input.plan.symbol,
    }, () => input.plan.marginMode);
  }
  command = { ...command, stage: 'leverage_pending', updatedAtMs: Date.now() };
  await writePendingPacificaCommand(command);
  if (current.leverage !== input.plan.leverage) {
    await applySetting(input, command, 'update_leverage', {
      leverage: input.plan.leverage,
      symbol: input.plan.symbol,
    }, () => input.plan.leverage);
  }
  return command;
}

async function applySetting(
  input: Parameters<typeof submitPacificaOrder>[0],
  command: PacificaCreateCommand,
  operation: 'update_margin_mode' | 'update_leverage',
  payload: Readonly<Record<string, unknown>>,
  expected: () => 'cross' | 'isolated' | number,
): Promise<void> {
  const startedAt = performance.now();
  try {
    await pacificaPostSigned({
      account: input.account,
      apiOrigin: input.apiOrigin,
      operation,
      payload,
      signer: input.signer,
      signal: input.signal,
    });
    recordOutcome(operation, command.traceId, startedAt, 'ok');
  } catch (cause) {
    recordOutcome(operation, command.traceId, startedAt, input.signal?.aborted ? 'cancelled' : 'error', cause);
    if (!isAmbiguousPacificaFailure(cause)) throw cause;
    try {
      const setting = await fetchPacificaMarketSetting({
        account: input.account,
        apiOrigin: input.apiOrigin,
        maxLeverage: input.plan.maxLeverage,
        signal: input.signal,
        symbol: input.plan.symbol,
      });
      const actual = operation === 'update_margin_mode' ? setting.marginMode : setting.leverage;
      if (actual === expected()) return;
    } catch {
      // A later review will fetch the authoritative setting before another order can proceed.
    }
    throw new PacificaCommandPendingError(
      'Pacifica margin settings could not be verified. No order was sent; review again after refresh.',
      command.traceId,
    );
  }
}

async function postOrder(
  input: Parameters<typeof submitPacificaOrder>[0],
  request: ReturnType<typeof orderRequest>,
  command: PacificaCreateCommand,
): Promise<PacificaOrderSubmission> {
  const submittedAt = performance.now();
  logTradeTiming(
    {
      action: input.plan.action,
      intentStartedAtMs: input.intentStartedAtMs,
      provider: 'pacifica',
      traceId: command.traceId,
    },
    'intent_to_submission',
    input.intentStartedAtMs,
    'ok',
  );
  const result = await pacificaPostSigned<unknown>({
    account: input.account,
    apiOrigin: input.apiOrigin,
    operation: request.operation,
    payload: request.payload,
    signer: input.signer,
    signal: input.signal,
  });
  logTradeTiming(
    {
      action: input.plan.action,
      intentStartedAtMs: input.intentStartedAtMs,
      provider: 'pacifica',
      traceId: command.traceId,
    },
    'submission_to_acknowledgement',
    submittedAt,
    'ok',
  );
  const orderId = parsePacificaOrderId(result);
  await writePendingPacificaCommand({
    ...command,
    orderId,
    stage: 'acknowledged',
    updatedAtMs: Date.now(),
  });
  return { orderId, orderStatus: 'accepted', traceId: command.traceId };
}

async function validateCurrentPrice(
  input: Parameters<typeof submitPacificaOrder>[0],
): Promise<void> {
  const latest = parsePacificaPrices(await pacificaGet<readonly unknown[]>({
    apiOrigin: input.apiOrigin,
    path: '/info/prices',
    signal: input.signal,
  })).find((price) => price.venueRef === input.plan.symbol);
  if (latest === undefined || latest.priceStale) {
    throw new Error('Pacifica price is stale. Review the order again.');
  }
  if (input.plan.orderType === 'market' && outsideSlippage(
    input.plan.markPrice,
    latest.price.baseUnits,
    latest.price.decimals,
  )) {
    throw new Error('Pacifica price moved beyond the confirmed slippage limit. Review again.');
  }
  if (isStopOrder(input.plan.orderType)) {
    if (input.plan.triggerPrice === null) throw new Error('The confirmed trigger price is missing.');
    validateStopDirection(
      parseDecimal(input.plan.triggerPrice, latest.price.decimals),
      latest.price.baseUnits,
      input.plan.signedSide,
    );
  }
}

function createCommand(
  input: Parameters<typeof submitPacificaOrder>[0],
  request: ReturnType<typeof orderRequest>,
): PacificaCreateCommand {
  const now = Date.now();
  return {
    action: input.plan.action,
    attemptedAtMs: now,
    clientOrderId: input.plan.clientOrderId,
    kind: 'create',
    leverage: input.plan.leverage,
    marginMode: input.plan.marginMode,
    maxLeverage: input.plan.maxLeverage,
    operation: request.operation,
    orderId: null,
    orderPayload: request.payload,
    owner: input.account,
    reviewExpiresAtMs: input.plan.expiresAtMs,
    stage: input.plan.action === 'open' ? 'margin_pending' : 'order_pending',
    symbol: input.plan.symbol,
    traceId: input.plan.traceId,
    updatedAtMs: now,
    version: 1,
  };
}

function orderRequest(plan: PacificaOrderPlan): {
  readonly operation: Extract<PacificaOperation, 'create_market_order' | 'create_order' | 'create_stop_order'>;
  readonly payload: Readonly<Record<string, unknown>>;
} {
  const targets = {
    ...(plan.stopLoss === null ? {} : {
      stop_loss: { client_order_id: plan.stopLoss.clientOrderId, stop_price: plan.stopLoss.stopPrice },
    }),
    ...(plan.takeProfit === null ? {} : {
      take_profit: { client_order_id: plan.takeProfit.clientOrderId, stop_price: plan.takeProfit.stopPrice },
    }),
  };
  const common = {
    amount: plan.amount,
    client_order_id: plan.clientOrderId,
    reduce_only: plan.reduceOnly,
    side: plan.signedSide,
    symbol: plan.symbol,
  };
  if (plan.orderType === 'market') {
    return { operation: 'create_market_order', payload: { ...common, slippage_percent: plan.slippagePercent, ...targets } };
  }
  if (plan.orderType === 'limit') {
    return { operation: 'create_order', payload: { ...common, price: plan.orderPrice, tif: 'GTC', ...targets } };
  }
  return {
    operation: 'create_stop_order',
    payload: {
      reduce_only: plan.reduceOnly,
      side: plan.signedSide,
      symbol: plan.symbol,
      stop_order: {
        amount: plan.amount,
        client_order_id: plan.clientOrderId,
        stop_price: plan.triggerPrice,
        trigger_price_type: 'mark_price',
        ...(plan.orderType === 'stop-limit' ? { limit_price: plan.orderPrice } : {}),
      },
    },
  };
}

async function reconcileAfterFailure(
  input: Parameters<typeof submitPacificaOrder>[0],
  traceId: string,
  cause: unknown,
): Promise<PacificaOrderSubmission | null> {
  try {
    const result = await reconcilePendingPacificaCommand({
      account: input.account,
      apiOrigin: input.apiOrigin,
      signal: input.signal,
    });
    const resolved = priorSubmission(result, input.plan.clientOrderId);
    if (resolved !== null) return resolved;
  } catch {
    // Preserve the command. A later foreground/user refresh can reconcile it.
  }
  recordClientTelemetry({
    durationMs: 0,
    errorCode: cause instanceof PacificaApiError ? cause.code : 'order_outcome_unknown',
    operation: 'trade.pacifica.create.outcome_unknown',
    outcome: 'unknown',
    traceId,
  });
  return null;
}

function priorSubmission(
  result: PacificaCommandReconciliation | null,
  clientOrderId: string,
): PacificaOrderSubmission | null {
  return result?.status === 'resolved' && result.kind === 'create' &&
    result.clientOrderId === clientOrderId
    ? { orderId: result.orderId, orderStatus: result.orderStatus, traceId: result.traceId }
    : null;
}

function priorCancellation(
  result: PacificaCommandReconciliation | null,
  orderId: number,
): PacificaCancellationResult | null {
  if (result?.status !== 'resolved' || result.kind !== 'cancel' || result.orderId !== orderId) {
    return null;
  }
  return {
    orderStatus: result.orderStatus,
    status: result.orderStatus === 'cancelled'
      ? 'cancelled'
      : result.orderStatus === 'open' || result.orderStatus === 'partially_filled'
        ? 'not_cancelled'
        : 'terminal',
    traceId: result.traceId,
  };
}

function requireCurrentPlan(plan: PacificaOrderPlan): void {
  if (Date.now() >= plan.expiresAtMs) {
    throw new Error('Pacifica order preview expired. Review a new quote.');
  }
  if (plan.action === 'open' && (plan.risk === null || plan.risk.verifiedAtMs <= 0)) {
    throw new Error('Pacifica risk could not be verified. Review a new order.');
  }
}

function outsideSlippage(mark: string, current: bigint, decimals: number): boolean {
  const confirmed = parseDecimal(mark, decimals);
  const difference = current > confirmed ? current - confirmed : confirmed - current;
  return confirmed <= 0n || difference * 10_000n > confirmed * 50n;
}

function recordOutcome(
  operation: string,
  traceId: string,
  startedAt: number,
  outcome: 'cancelled' | 'error' | 'ok',
  cause?: unknown,
): void {
  recordClientTelemetry({
    durationMs: performance.now() - startedAt,
    ...(cause instanceof PacificaApiError ? { errorCode: cause.code } : {}),
    operation: `trade.pacifica.${operation}`,
    outcome,
    traceId,
  });
}
